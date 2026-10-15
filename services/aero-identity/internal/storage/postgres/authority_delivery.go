package postgres

import (
	"context"
	"errors"

	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/delivery"
	identitysqlc "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DeliveryRepository struct{ queries *identitysqlc.Queries }

func NewDeliveryRepository(db *pgxpool.Pool) *DeliveryRepository {
	return &DeliveryRepository{queries: identitysqlc.New(db)}
}
func deliveryUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }
func deliveryError(ctx context.Context, err error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return delivery.ErrUnavailable
	}
	return nil
}
func (r *DeliveryRepository) Claim(ctx context.Context, owner uuid.UUID) (*delivery.Claim, error) {
	if owner == uuid.Nil {
		return nil, delivery.ErrUnavailable
	}
	row, err := r.queries.ClaimAuthorityDelivery(ctx, deliveryUUID(owner))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, deliveryError(ctx, err)
	}
	session := uuid.Nil
	if row.SessionID.Valid {
		session = uuid.UUID(row.SessionID.Bytes)
	}
	return &delivery.Claim{Event: delivery.Event{ID: row.EventID, SubjectID: row.SubjectID, UserID: row.UserID, DeviceID: row.DeviceID, SessionID: session, Kind: row.SubjectKind, Revision: row.SourceRevision}, Owner: owner, Fence: row.ClaimFence, Attempt: row.Attempt}, nil
}
func (r *DeliveryRepository) HasExhausted(ctx context.Context) (bool, error) {
	result, err := r.queries.HasExhaustedAuthorityDelivery(ctx)
	return result, deliveryError(ctx, err)
}
func changedDelivery(ctx context.Context, changed int64, err error) error {
	if err != nil {
		return deliveryError(ctx, err)
	}
	if changed != 1 {
		return delivery.ErrStaleClaim
	}
	return nil
}
func (r *DeliveryRepository) Complete(ctx context.Context, c delivery.Claim, receipt delivery.Receipt) error {
	if !receipt.ValidFor(c.Event) {
		return delivery.ErrUnavailable
	}
	changed, err := r.queries.CompleteAuthorityDelivery(ctx, identitysqlc.CompleteAuthorityDeliveryParams{EventID: c.Event.ID, OwnerID: deliveryUUID(c.Owner), Fence: c.Fence, OperationID: deliveryUUID(receipt.OperationID), MediaEffect: pgtype.Text{String: receipt.Effect, Valid: true}, GrantCount: pgtype.Int8{Int64: receipt.Count, Valid: true}})
	return changedDelivery(ctx, changed, err)
}
func (r *DeliveryRepository) Quarantine(ctx context.Context, c delivery.Claim, reason string) error {
	if reason != "canonical_conflict" && reason != "source_row_invalid" {
		return delivery.ErrUnavailable
	}
	changed, err := r.queries.QuarantineAuthorityDelivery(ctx, identitysqlc.QuarantineAuthorityDeliveryParams{EventID: c.Event.ID, OwnerID: deliveryUUID(c.Owner), Fence: c.Fence, Reason: pgtype.Text{String: reason, Valid: true}})
	return changedDelivery(ctx, changed, err)
}
func (r *DeliveryRepository) Retry(ctx context.Context, c delivery.Claim, seconds int32) error {
	if seconds < 1 || seconds > 30 {
		return delivery.ErrUnavailable
	}
	changed, err := r.queries.RetryAuthorityDelivery(ctx, identitysqlc.RetryAuthorityDeliveryParams{EventID: c.Event.ID, OwnerID: deliveryUUID(c.Owner), Fence: c.Fence, RetrySeconds: float64(seconds)})
	return changedDelivery(ctx, changed, err)
}
