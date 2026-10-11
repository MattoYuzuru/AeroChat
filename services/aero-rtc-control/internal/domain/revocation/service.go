package revocation

import (
	"context"
	"errors"
	"strings"
	"time"

	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/google/uuid"
)

var (
	ErrInvalidArgument = errors.New("invalid source event")
	ErrNotFound        = errors.New("source event receipt not found")
	ErrConflict        = errors.New("source event payload conflict")
	ErrUnavailable     = errors.New("source event receiver unavailable")
)

type Receipt struct {
	Domain                 string
	EventID, OperationID   uuid.UUID
	AffectedRegistryGrants int64
}
type IdentityEvent struct {
	EventID, Kind, SubjectID, UserID, DeviceID string
	Revision                                   int64
}
type ChatEvent struct {
	EventID, GroupID, UserID string
	Revision                 int64
}
type Repository interface {
	ApplySourceEvent(context.Context, media.SourceEvent) (media.Operation, error)
	GetSourceReceipt(context.Context, string, uuid.UUID) (Receipt, error)
}
type Service struct {
	repo Repository
	now  func() time.Time
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

func parseID(value string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil || id == uuid.Nil {
		return uuid.Nil, ErrInvalidArgument
	}
	return id, nil
}

func (s *Service) ApplyIdentityEvent(ctx context.Context, r IdentityEvent) (Receipt, error) {
	e := media.SourceEvent{Domain: "identity", Kind: r.Kind, Revision: r.Revision, At: s.now()}
	var err error
	if e.EventID, err = parseID(r.EventID); err != nil {
		return Receipt{}, err
	}
	if e.SubjectID, err = parseID(r.SubjectID); err != nil {
		return Receipt{}, err
	}
	if e.UserID, err = parseID(r.UserID); err != nil {
		return Receipt{}, err
	}
	if e.DeviceID, err = parseID(r.DeviceID); err != nil {
		return Receipt{}, err
	}
	if e.Kind != "session" && e.Kind != "device" {
		return Receipt{}, ErrInvalidArgument
	}
	return s.apply(ctx, e)
}

func (s *Service) ApplyChatEvent(ctx context.Context, r ChatEvent) (Receipt, error) {
	e := media.SourceEvent{Domain: "chat", Kind: "group", Revision: r.Revision, At: s.now()}
	var err error
	if e.EventID, err = parseID(r.EventID); err != nil {
		return Receipt{}, err
	}
	if e.SubjectID, err = parseID(r.GroupID); err != nil {
		return Receipt{}, err
	}
	if e.UserID, err = parseID(r.UserID); err != nil {
		return Receipt{}, err
	}
	return s.apply(ctx, e)
}

func (s *Service) apply(ctx context.Context, e media.SourceEvent) (Receipt, error) {
	if e.Validate() != nil {
		return Receipt{}, ErrInvalidArgument
	}
	if s.repo == nil {
		return Receipt{}, ErrUnavailable
	}
	if _, err := s.repo.ApplySourceEvent(ctx, e); err != nil {
		return Receipt{}, mapRepositoryError(err)
	}
	// Потеря response после commit оставляет durable event; retry получает
	// текущий own-event receipt. Empty journal completion не media completion.
	return s.receipt(ctx, e.Domain, e.EventID)
}

func (s *Service) GetIdentityEventReceipt(ctx context.Context, event string) (Receipt, error) {
	id, err := parseID(event)
	if err != nil {
		return Receipt{}, err
	}
	return s.receipt(ctx, "identity", id)
}
func (s *Service) GetChatEventReceipt(ctx context.Context, event string) (Receipt, error) {
	id, err := parseID(event)
	if err != nil {
		return Receipt{}, err
	}
	return s.receipt(ctx, "chat", id)
}
func (s *Service) receipt(ctx context.Context, domain string, event uuid.UUID) (Receipt, error) {
	if s.repo == nil {
		return Receipt{}, ErrUnavailable
	}
	r, err := s.repo.GetSourceReceipt(ctx, domain, event)
	if err != nil {
		return Receipt{}, mapRepositoryError(err)
	}
	if r.Domain != domain || r.EventID != event || r.OperationID == uuid.Nil || r.AffectedRegistryGrants < 0 {
		return Receipt{}, ErrUnavailable
	}
	return r, nil
}
func mapRepositoryError(err error) error {
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return err
	case errors.Is(err, ErrNotFound):
		return ErrNotFound
	case errors.Is(err, media.ErrConflict):
		return ErrConflict
	default:
		return ErrUnavailable
	}
}
