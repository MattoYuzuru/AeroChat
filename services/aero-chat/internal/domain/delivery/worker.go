package delivery

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"log/slog"
	"time"
)

const (
	AttemptBudget = 5 * time.Second
	ClaimLease    = 15 * time.Second
	WakeInterval  = time.Second
)

var (
	ErrUnavailable = errors.New("Chat source delivery unavailable")
	ErrExhausted   = errors.New("Chat source delivery counter exhausted")
	ErrStaleClaim  = errors.New("Chat source delivery claim stale")
	ErrNotFound    = errors.New("Chat source receipt not found")
	ErrConflict    = errors.New("Chat source canonical conflict")
)

type Event struct {
	ID, GroupID, UserID uuid.UUID
	Epoch               int64
	SourceReason        string
}

func (e Event) Validate() bool {
	return e.ID != uuid.Nil && e.GroupID != uuid.Nil && e.UserID != uuid.Nil && e.Epoch > 0 &&
		(e.SourceReason == "eligibility_denied" || e.SourceReason == "member_removed")
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
	return r.EventID == e.ID && r.OperationID != uuid.Nil &&
		(r.Effect == "no_matching_registry_grants" && r.Count == 0 ||
			r.Effect == "media_pending" && r.Count > 0 && r.Count <= 4294967295)
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
	value := int32(1)
	for attempt > 1 && value < 30 {
		value *= 2
		if value > 30 {
			value = 30
		}
		attempt--
	}
	return value
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
	var result Receipt
	var prior *Receipt
	if claim.Attempt > 1 {
		result, err = w.client.Lookup(ctx, claim.Event.ID)
		if err == nil && result.ValidFor(claim.Event) {
			copy := result
			prior = &copy
			result, err = w.client.Apply(ctx, claim.Event)
		}
	} else {
		err = ErrNotFound
	}
	if errors.Is(err, ErrNotFound) {
		result, err = w.client.Apply(ctx, claim.Event)
	}
	if errors.Is(err, ErrConflict) {
		return w.repository.Quarantine(ctx, *claim, "canonical_conflict")
	}
	if err != nil || !result.ValidFor(claim.Event) || prior != nil && prior.OperationID != result.OperationID {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := w.repository.Retry(ctx, *claim, RetrySeconds(claim.Attempt)); err != nil {
			return err
		}
		return ErrUnavailable
	}
	return w.repository.Complete(ctx, *claim, result)
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
			w.logger.Warn("Chat source delivery attempt pending", slog.String("reason", reason))
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
