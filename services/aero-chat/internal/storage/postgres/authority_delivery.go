package postgres

import (
	"context"
	"errors"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/delivery"
	chatsqlc "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DeliveryRepository struct{ queries *chatsqlc.Queries }

func NewDeliveryRepository(db *pgxpool.Pool) *DeliveryRepository {
	return &DeliveryRepository{queries: chatsqlc.New(db)}
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
	row, err := r.queries.ClaimChatAuthorityDelivery(ctx, deliveryUUID(owner))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, deliveryError(ctx, err)
	}
	return &delivery.Claim{Event: delivery.Event{ID: row.EventID, GroupID: row.GroupID, UserID: row.UserID, Epoch: row.SourceRevision, SourceReason: row.Reason}, Owner: owner, Fence: row.ClaimFence, Attempt: row.Attempt}, nil
}
func (r *DeliveryRepository) HasExhausted(ctx context.Context) (bool, error) {
	yes, err := r.queries.HasExhaustedChatAuthorityDelivery(ctx)
	return yes, deliveryError(ctx, err)
}
func changedDelivery(ctx context.Context, n int64, err error) error {
	if err != nil {
		return deliveryError(ctx, err)
	}
	if n != 1 {
		return delivery.ErrStaleClaim
	}
	return nil
}
func (r *DeliveryRepository) Complete(ctx context.Context, c delivery.Claim, result delivery.Receipt) error {
	if !result.ValidFor(c.Event) {
		return delivery.ErrUnavailable
	}
	n, err := r.queries.CompleteChatAuthorityDelivery(ctx, chatsqlc.CompleteChatAuthorityDeliveryParams{EventID: c.Event.ID, OwnerID: deliveryUUID(c.Owner), Fence: c.Fence, OperationID: deliveryUUID(result.OperationID), MediaEffect: pgtype.Text{String: result.Effect, Valid: true}, GrantCount: pgtype.Int8{Int64: result.Count, Valid: true}})
	return changedDelivery(ctx, n, err)
}
func (r *DeliveryRepository) Quarantine(ctx context.Context, c delivery.Claim, reason string) error {
	if reason != "canonical_conflict" && reason != "source_row_invalid" {
		return delivery.ErrUnavailable
	}
	n, err := r.queries.QuarantineChatAuthorityDelivery(ctx, chatsqlc.QuarantineChatAuthorityDeliveryParams{EventID: c.Event.ID, OwnerID: deliveryUUID(c.Owner), Fence: c.Fence, Reason: pgtype.Text{String: reason, Valid: true}})
	return changedDelivery(ctx, n, err)
}
func (r *DeliveryRepository) Retry(ctx context.Context, c delivery.Claim, seconds int32) error {
	if seconds < 1 || seconds > 30 {
		return delivery.ErrUnavailable
	}
	n, err := r.queries.RetryChatAuthorityDelivery(ctx, chatsqlc.RetryChatAuthorityDeliveryParams{EventID: c.Event.ID, OwnerID: deliveryUUID(c.Owner), Fence: c.Fence, RetrySeconds: float64(seconds)})
	return changedDelivery(ctx, n, err)
}
