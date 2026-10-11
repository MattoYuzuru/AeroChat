package delivery

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

const (
	AttemptBudget = 5 * time.Second
	ClaimLease    = 15 * time.Second
	WakeInterval  = time.Second
)

var (
	ErrUnavailable = errors.New("source delivery unavailable")
	ErrExhausted   = errors.New("source delivery counter exhausted")
	ErrStaleClaim  = errors.New("source delivery claim stale")
	ErrNotFound    = errors.New("source receipt not found")
	ErrConflict    = errors.New("source canonical conflict")
)

type Event struct {
	ID, SubjectID, UserID, DeviceID, SessionID uuid.UUID
	Kind                                       string
	Revision                                   int64
}

func (e Event) Validate() bool {
	if e.ID == uuid.Nil || e.SubjectID == uuid.Nil || e.UserID == uuid.Nil || e.DeviceID == uuid.Nil || e.Revision <= 0 {
		return false
	}
	return e.Kind == "session" && e.SessionID == e.SubjectID || e.Kind == "device" && e.SessionID == uuid.Nil && e.SubjectID == e.DeviceID
}

type Claim struct {
	Event          Event
	Owner          uuid.UUID
	Fence, Attempt int64
}
type Receipt struct {
	EventID, OperationID uuid.UUID
	Effect               string
	Count                int64
}

func (r Receipt) ValidFor(e Event) bool {
	return r.EventID == e.ID && r.OperationID != uuid.Nil && ((r.Effect == "no_matching_registry_grants" && r.Count == 0) || (r.Effect == "media_pending" && r.Count > 0 && r.Count <= 4294967295))
}

type Repository interface {
	Claim(context.Context, uuid.UUID) (*Claim, error)
	HasExhausted(context.Context) (bool, error)
	Complete(context.Context, Claim, Receipt) error
	Quarantine(context.Context, Claim, string) error
	Retry(context.Context, Claim, int32) error
}
type Client interface {
	Apply(context.Context, Event) (Receipt, error)
	Lookup(context.Context, uuid.UUID) (Receipt, error)
}
type Worker struct {
	repository Repository
	client     Client
	owner      uuid.UUID
	logger     *slog.Logger
}

func NewWorker(repository Repository, client Client, logger *slog.Logger) *Worker {
	return &Worker{repository: repository, client: client, owner: uuid.New(), logger: logger}
}
func RetrySeconds(attempt int64) int32 {
	seconds := int32(1)
	for attempt > 1 && seconds < 30 {
		seconds *= 2
		if seconds > 30 {
			seconds = 30
		}
		attempt--
	}
	return seconds
}
func (w *Worker) Step(parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, AttemptBudget)
	defer cancel()
	claim, err := w.repository.Claim(ctx, w.owner)
	if err != nil {
		return err
	}
	if claim == nil {
		exhausted, err := w.repository.HasExhausted(ctx)
		if err != nil {
			return err
		}
		if exhausted {
			return ErrExhausted
		}
		return nil
	}
	if !claim.Event.Validate() {
		return w.repository.Quarantine(ctx, *claim, "source_row_invalid")
	}
	var receipt Receipt
	if claim.Attempt > 1 {
		receipt, err = w.client.Lookup(ctx, claim.Event.ID)
	} else {
		err = ErrNotFound
	}
	if errors.Is(err, ErrNotFound) {
		receipt, err = w.client.Apply(ctx, claim.Event)
	}
	if errors.Is(err, ErrConflict) {
		return w.repository.Quarantine(ctx, *claim, "canonical_conflict")
	}
	if err != nil || !receipt.ValidFor(claim.Event) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if retryErr := w.repository.Retry(ctx, *claim, RetrySeconds(claim.Attempt)); retryErr != nil {
			return retryErr
		}
		return ErrUnavailable
	}
	return w.repository.Complete(ctx, *claim, receipt)
}
func (w *Worker) Run(ctx context.Context) error {
	ticker := time.NewTicker(WakeInterval)
	defer ticker.Stop()
	for {
		if err := w.Step(ctx); err != nil && ctx.Err() == nil {
			reason := "delivery_unavailable"
			if errors.Is(err, ErrExhausted) {
				reason = "exhausted_counter"
			}
			w.logger.Warn("source delivery attempt pending", slog.String("reason", reason))
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
