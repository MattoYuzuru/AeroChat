package postgres

import (
	"context"
	"errors"
	"math"

	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/admission"
	rtcsqlc "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RegistrationStore struct{ db *pgxpool.Pool }

func NewRegistrationStore(db *pgxpool.Pool) *RegistrationStore { return &RegistrationStore{db: db} }
func registrationError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return admission.ErrUnavailable
	}
	return nil
}
func (s *RegistrationStore) Register(ctx context.Context, leaf [32]byte, request uuid.UUID) (*admission.Instance, error) {
	if request == uuid.Nil {
		return nil, admission.ErrInvalidArgument
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, registrationError(ctx, err)
	}
	defer rollbackMedia(tx)
	q := rtcsqlc.New(tx)
	last, err := q.LockAdmissionFence(ctx)
	if err != nil {
		return nil, registrationError(ctx, err)
	}
	row, err := q.GetAdmissionInstanceByLeaf(ctx, leaf[:])
	if err == nil {
		if row.RequestID != request {
			return nil, admission.ErrConflict
		}
		result := &admission.Instance{ID: row.InstanceID, RequestID: row.RequestID, Fence: row.RegistrationFence, State: row.State}
		if !result.ValidFor(request) {
			return nil, admission.ErrUnavailable
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, registrationError(ctx, err)
		}
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, registrationError(ctx, err)
	}
	if last == math.MaxInt64 {
		return nil, admission.ErrUnavailable
	}
	fence, err := q.AdvanceAdmissionFence(ctx)
	if err != nil {
		return nil, registrationError(ctx, err)
	}
	row, err = q.CreateAdmissionInstance(ctx, rtcsqlc.CreateAdmissionInstanceParams{LeafFingerprint: leaf[:], InstanceID: uuid.New(), RequestID: request, RegistrationFence: fence})
	if err != nil {
		return nil, registrationError(ctx, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, registrationError(ctx, err)
	}
	return &admission.Instance{ID: row.InstanceID, RequestID: row.RequestID, Fence: row.RegistrationFence, State: row.State}, nil
}
