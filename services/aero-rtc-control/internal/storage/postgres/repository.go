package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	rtcsqlc "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/sqlc"
)

type Repository struct {
	db      *pgxpool.Pool
	queries *rtcsqlc.Queries
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{
		db:      db,
		queries: rtcsqlc.New(db),
	}
}

func (r *Repository) Ping(ctx context.Context) error {
	return r.db.Ping(ctx)
}

func (r *Repository) GetCallByID(ctx context.Context, callID string) (*rtc.Call, error) {
	row, err := r.queries.GetCallByID(ctx, mustParseUUID(callID))
	if err != nil {
		return nil, convertError(err)
	}

	return toDomainCallFromGetCallRow(row), nil
}

func (r *Repository) GetActiveCallByScope(ctx context.Context, scope rtc.ConversationScope) (*rtc.Call, error) {
	switch scope.Type {
	case rtc.ScopeTypeDirect:
		row, err := r.queries.GetActiveCallByDirectChatID(ctx, uuidValue(scope.DirectChatID))
		if err != nil {
			return nil, convertError(err)
		}

		return toDomainCallFromDirectScopeRow(row), nil
	case rtc.ScopeTypeGroup:
		row, err := r.queries.GetActiveCallByGroupID(ctx, uuidValue(scope.GroupID))
		if err != nil {
			return nil, convertError(err)
		}

		return toDomainCallFromGroupScopeRow(row), nil
	default:
		return nil, fmt.Errorf("%w: unsupported scope type", rtc.ErrInvalidArgument)
	}
}

func (r *Repository) GetActiveParticipationByUserID(ctx context.Context, userID string) (*rtc.ActiveParticipation, error) {
	row, err := r.queries.GetActiveParticipationByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	return &rtc.ActiveParticipation{
		Call: rtc.Call{
			ID: row.ID.String(),
			Scope: toDomainScope(
				row.ScopeType,
				row.DirectChatID,
				row.GroupID,
			),
			CreatedByUserID: row.CreatedByUserID.String(),
			Status:          row.Status,
			CreatedAt:       row.CreatedAt.Time.UTC(),
			UpdatedAt:       row.UpdatedAt.Time.UTC(),
			StartedAt:       row.StartedAt.Time.UTC(),
			EndedAt:         timestampPointer(row.EndedAt),
			EndedByUserID:   uuidPointerString(row.EndedByUserID),
			EndReason:       textValue(row.EndReason),
		},
		Participant: rtc.CallParticipant{
			ID:           row.ParticipantID.String(),
			CallID:       row.ID.String(),
			UserID:       row.UserID.String(),
			State:        row.State,
			JoinedAt:     row.JoinedAt.Time.UTC(),
			LeftAt:       timestampPointer(row.LeftAt),
			UpdatedAt:    row.ParticipantUpdatedAt.Time.UTC(),
			LastSignalAt: timestampPointer(row.LastSignalAt),
		},
	}, nil
}

func (r *Repository) CreateCallWithParticipant(ctx context.Context, call rtc.Call, participant rtc.CallParticipant) (*rtc.Call, *rtc.CallParticipant, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	callRow, err := q.CreateCall(ctx, rtcsqlc.CreateCallParams{
		ID:              mustParseUUID(call.ID),
		ScopeType:       call.Scope.Type,
		DirectChatID:    uuidValue(call.Scope.DirectChatID),
		GroupID:         uuidValue(call.Scope.GroupID),
		CreatedByUserID: mustParseUUID(call.CreatedByUserID),
		Status:          call.Status,
		CreatedAt:       timestamptzValue(call.CreatedAt),
		StartedAt:       timestamptzValue(call.StartedAt),
		UpdatedAt:       timestamptzValue(call.UpdatedAt),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}

	participantRow, err := q.CreateParticipant(ctx, rtcsqlc.CreateParticipantParams{
		ID:        mustParseUUID(participant.ID),
		CallID:    mustParseUUID(participant.CallID),
		UserID:    mustParseUUID(participant.UserID),
		State:     participant.State,
		JoinedAt:  timestamptzValue(participant.JoinedAt),
		UpdatedAt: timestamptzValue(participant.UpdatedAt),
	})
	if err != nil {
		return nil, nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("commit tx: %w", err)
	}

	createdCall := toDomainCallFromBase(callRow)
	createdCall.ActiveParticipantCount = 1
	createdParticipant := toDomainParticipant(participantRow)

	return createdCall, &createdParticipant, nil
}

func (r *Repository) CreateParticipant(ctx context.Context, participant rtc.CallParticipant) (*rtc.CallParticipant, error) {
	row, err := r.queries.CreateParticipant(ctx, rtcsqlc.CreateParticipantParams{
		ID:        mustParseUUID(participant.ID),
		CallID:    mustParseUUID(participant.CallID),
		UserID:    mustParseUUID(participant.UserID),
		State:     participant.State,
		JoinedAt:  timestamptzValue(participant.JoinedAt),
		UpdatedAt: timestamptzValue(participant.UpdatedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	result := toDomainParticipant(row)
	return &result, nil
}

func (r *Repository) GetActiveParticipant(ctx context.Context, callID string, userID string) (*rtc.CallParticipant, error) {
	row, err := r.queries.GetActiveParticipantByCallIDAndUserID(ctx, rtcsqlc.GetActiveParticipantByCallIDAndUserIDParams{
		CallID: mustParseUUID(callID),
		UserID: mustParseUUID(userID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	result := toDomainParticipant(row)
	return &result, nil
}

func (r *Repository) ListActiveParticipants(ctx context.Context, callID string) ([]rtc.CallParticipant, error) {
	rows, err := r.queries.ListActiveParticipantsByCallID(ctx, mustParseUUID(callID))
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]rtc.CallParticipant, 0, len(rows))
	for _, row := range rows {
		result = append(result, toDomainParticipant(row))
	}

	return result, nil
}

func (r *Repository) LeaveParticipant(ctx context.Context, participantID string, at time.Time) (bool, error) {
	affected, err := r.queries.LeaveParticipant(ctx, rtcsqlc.LeaveParticipantParams{
		LeftAt:    timestamptzValue(at),
		UpdatedAt: timestamptzValue(at),
		ID:        mustParseUUID(participantID),
	})
	if err != nil {
		return false, convertError(err)
	}

	return affected > 0, nil
}

func (r *Repository) LeaveActiveParticipantsByCallID(ctx context.Context, callID string, at time.Time) error {
	_, err := r.queries.LeaveActiveParticipantsByCallID(ctx, rtcsqlc.LeaveActiveParticipantsByCallIDParams{
		LeftAt:    timestamptzValue(at),
		UpdatedAt: timestamptzValue(at),
		CallID:    mustParseUUID(callID),
	})

	return convertError(err)
}

func (r *Repository) TouchParticipantSignal(ctx context.Context, participantID string, at time.Time) error {
	_, err := r.queries.TouchParticipantSignal(ctx, rtcsqlc.TouchParticipantSignalParams{
		LastSignalAt: timestamptzValue(at),
		UpdatedAt:    timestamptzValue(at),
		ID:           mustParseUUID(participantID),
	})

	return convertError(err)
}

func (r *Repository) CountActiveParticipants(ctx context.Context, callID string) (int64, error) {
	count, err := r.queries.CountActiveParticipantsByCallID(ctx, mustParseUUID(callID))
	if err != nil {
		return 0, convertError(err)
	}

	return count, nil
}

func (r *Repository) EndCall(ctx context.Context, callID string, endedByUserID *string, endReason string, at time.Time) (bool, error) {
	affected, err := r.queries.EndCall(ctx, rtcsqlc.EndCallParams{
		UpdatedAt:     timestamptzValue(at),
		EndedAt:       timestamptzValue(at),
		EndedByUserID: uuidPointerValue(endedByUserID),
		EndReason:     textPointerValue(stringPointer(endReason)),
		ID:            mustParseUUID(callID),
	})
	if err != nil {
		return false, convertError(err)
	}

	return affected > 0, nil
}

func convertError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return rtc.ErrNotFound
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if pgErr.Code == "23505" {
			return fmt.Errorf("%w: %s", rtc.ErrConflict, strings.TrimSpace(pgErr.ConstraintName))
		}
	}

	return err
}

func mustParseUUID(value string) uuid.UUID {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		panic(err)
	}

	return parsed
}

func uuidValue(value string) pgtype.UUID {
	if strings.TrimSpace(value) == "" {
		return pgtype.UUID{}
	}

	return pgtype.UUID{Bytes: mustParseUUID(value), Valid: true}
}

func uuidPointerValue(value *string) pgtype.UUID {
	if value == nil || strings.TrimSpace(*value) == "" {
		return pgtype.UUID{}
	}

	return uuidValue(*value)
}

func timestamptzValue(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value.UTC(), Valid: true}
}

func textPointerValue(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}

	return pgtype.Text{String: *value, Valid: true}
}

func stringPointer(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}

	result := value
	return &result
}

func timestampPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}

	result := value.Time.UTC()
	return &result
}

func toDomainCallFromGetCallRow(row rtcsqlc.GetCallByIDRow) *rtc.Call {
	result := toDomainCallFromBase(rtcsqlc.RtcCall{
		ID:              row.ID,
		ScopeType:       row.ScopeType,
		DirectChatID:    row.DirectChatID,
		GroupID:         row.GroupID,
		CreatedByUserID: row.CreatedByUserID,
		Status:          row.Status,
		CreatedAt:       row.CreatedAt,
		StartedAt:       row.StartedAt,
		UpdatedAt:       row.UpdatedAt,
		EndedAt:         row.EndedAt,
		EndedByUserID:   row.EndedByUserID,
		EndReason:       row.EndReason,
	})
	result.ActiveParticipantCount = uint32(row.ActiveParticipantCount)
	return result
}

func toDomainCallFromDirectScopeRow(row rtcsqlc.GetActiveCallByDirectChatIDRow) *rtc.Call {
	result := toDomainCallFromBase(rtcsqlc.RtcCall{
		ID:              row.ID,
		ScopeType:       row.ScopeType,
		DirectChatID:    row.DirectChatID,
		GroupID:         row.GroupID,
		CreatedByUserID: row.CreatedByUserID,
		Status:          row.Status,
		CreatedAt:       row.CreatedAt,
		StartedAt:       row.StartedAt,
		UpdatedAt:       row.UpdatedAt,
		EndedAt:         row.EndedAt,
		EndedByUserID:   row.EndedByUserID,
		EndReason:       row.EndReason,
	})
	result.ActiveParticipantCount = uint32(row.ActiveParticipantCount)
	return result
}

func toDomainCallFromGroupScopeRow(row rtcsqlc.GetActiveCallByGroupIDRow) *rtc.Call {
	result := toDomainCallFromBase(rtcsqlc.RtcCall{
		ID:              row.ID,
		ScopeType:       row.ScopeType,
		DirectChatID:    row.DirectChatID,
		GroupID:         row.GroupID,
		CreatedByUserID: row.CreatedByUserID,
		Status:          row.Status,
		CreatedAt:       row.CreatedAt,
		StartedAt:       row.StartedAt,
		UpdatedAt:       row.UpdatedAt,
		EndedAt:         row.EndedAt,
		EndedByUserID:   row.EndedByUserID,
		EndReason:       row.EndReason,
	})
	result.ActiveParticipantCount = uint32(row.ActiveParticipantCount)
	return result
}

func toDomainCallFromBase(row rtcsqlc.RtcCall) *rtc.Call {
	return &rtc.Call{
		ID:              row.ID.String(),
		Scope:           toDomainScope(row.ScopeType, row.DirectChatID, row.GroupID),
		CreatedByUserID: row.CreatedByUserID.String(),
		Status:          row.Status,
		CreatedAt:       row.CreatedAt.Time.UTC(),
		UpdatedAt:       row.UpdatedAt.Time.UTC(),
		StartedAt:       row.StartedAt.Time.UTC(),
		EndedAt:         timestampPointer(row.EndedAt),
		EndedByUserID:   uuidTextPointer(row.EndedByUserID),
		EndReason:       textValue(row.EndReason),
	}
}

func toDomainParticipant(row rtcsqlc.RtcCallParticipant) rtc.CallParticipant {
	return rtc.CallParticipant{
		ID:           row.ID.String(),
		CallID:       row.CallID.String(),
		UserID:       row.UserID.String(),
		State:        row.State,
		JoinedAt:     row.JoinedAt.Time.UTC(),
		LeftAt:       timestampPointer(row.LeftAt),
		UpdatedAt:    row.UpdatedAt.Time.UTC(),
		LastSignalAt: timestampPointer(row.LastSignalAt),
	}
}

func toDomainScope(scopeType string, directChatID pgtype.UUID, groupID pgtype.UUID) rtc.ConversationScope {
	if scopeType == rtc.ScopeTypeDirect {
		return rtc.ConversationScope{
			Type:         rtc.ScopeTypeDirect,
			DirectChatID: directChatID.String(),
		}
	}

	return rtc.ConversationScope{
		Type:    rtc.ScopeTypeGroup,
		GroupID: groupID.String(),
	}
}

func uuidPointerString(value pgtype.UUID) *string {
	if !value.Valid {
		return nil
	}

	result := value.String()
	return &result
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}

	return value.String
}

func uuidTextPointer(value pgtype.UUID) *string {
	if !value.Valid {
		return nil
	}

	result := value.String()
	return &result
}
