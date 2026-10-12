package admission

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

var (
	ErrInvalidArgument = errors.New("invalid registration request")
	ErrDenied          = errors.New("registration caller denied")
	ErrConflict        = errors.New("registration leaf already bound")
	ErrUnavailable     = errors.New("registration unavailable")
)

type Instance struct {
	ID, RequestID uuid.UUID
	Fence         int64
	State         string
}

func (i Instance) ValidFor(request uuid.UUID) bool {
	return i.ID != uuid.Nil && i.RequestID == request && i.Fence > 0 && (i.State == "active" || i.State == "draining" || i.State == "retired")
}

type verifiedLeafKey struct{}

// WithVerifiedLeaf применяется только проверенным transport adapter, не body/header.
func WithVerifiedLeaf(ctx context.Context, fingerprint [32]byte) context.Context {
	return context.WithValue(ctx, verifiedLeafKey{}, fingerprint)
}
func VerifiedLeaf(ctx context.Context) ([32]byte, bool) {
	value, ok := ctx.Value(verifiedLeafKey{}).([32]byte)
	return value, ok
}

type Repository interface {
	Register(context.Context, [32]byte, uuid.UUID) (*Instance, error)
}
type Service struct{ repository Repository }

func NewService(repository Repository) *Service { return &Service{repository: repository} }
func (s *Service) RegisterInstance(ctx context.Context, requestID string) (*Instance, error) {
	fingerprint, verified := VerifiedLeaf(ctx)
	if !verified {
		return nil, ErrDenied
	}
	request, err := uuid.Parse(requestID)
	if err != nil || request == uuid.Nil || request.String() != requestID {
		return nil, ErrInvalidArgument
	}
	if s.repository == nil {
		return nil, ErrUnavailable
	}
	result, err := s.repository.Register(ctx, fingerprint, request)
	if err != nil {
		return nil, err
	}
	if result == nil || !result.ValidFor(request) {
		return nil, ErrUnavailable
	}
	return result, nil
}
