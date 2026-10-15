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
	db             *pgxpool.Pool
	queries        *rtcsqlc.Queries
	mediaSlotGuard bool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{
		db:      db,
		queries: rtcsqlc.New(db),
	}
}

// Constructor policy остаётся dormant: main/config не включает guard.
func NewRepositoryWithMediaSlotGuard(db *pgxpool.Pool) *Repository {
	r := NewRepository(db)
	r.mediaSlotGuard = true
	return r
}

func (r *Repository) beginLegacySlot(ctx context.Context, s slotSpec) (pgx.Tx, *slotTransaction, error) {
	if !r.mediaSlotGuard {
		tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
		return tx, nil, err
	}
	slot, err := retrySlot(ctx, func() (*slotTransaction, error) { return beginSlotTransaction(ctx, r.db, r.queries, s) })
	if err != nil {
		return nil, nil, slotLegacyError(err)
	}
	return slot.tx, slot, nil
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

func (r *Repository) CreateCallWithParticipant(ctx context.Context, call rtc.Call, participant rtc.CallParticipant) (resultCall *rtc.Call, resultParticipant *rtc.CallParticipant, resultErr error) {
	if r.mediaSlotGuard {
		defer func() { resultErr = slotLegacyError(resultErr) }()
	}
	spec := slotSpec{call: mustParseUUID(call.ID), user: mustParseUUID(participant.UserID), create: true}
	if r.mediaSlotGuard && (spec.call == uuid.Nil || spec.user == uuid.Nil || mustParseUUID(participant.ID) == uuid.Nil || mustParseUUID(participant.CallID) != spec.call || mustParseUUID(call.CreatedByUserID) != spec.user) {
		return nil, nil, rtc.ErrInvalidArgument
	}
	tx, slot, err := r.beginLegacySlot(ctx, spec)
	if err != nil {
		if !r.mediaSlotGuard {
			return nil, nil, fmt.Errorf("begin tx: %w", err)
		}
		return nil, nil, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	if slot != nil {
		defer rollbackMedia(tx)
		if err := slot.allowLegacyJoin(spec); err != nil {
			return nil, nil, err
		}
	}
	if err := q.ReleaseEndedParticipationByUserID(ctx, rtcsqlc.ReleaseEndedParticipationByUserIDParams{
		UserID: mustParseUUID(participant.UserID), At: timestamptzValue(participant.UpdatedAt),
	}); err != nil {
		return nil, nil, convertError(err)
	}
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
	_, joined, err := r.JoinParticipant(ctx, participant)
	return joined, err
}

func (r *Repository) JoinParticipant(ctx context.Context, participant rtc.CallParticipant) (resultCall *rtc.Call, resultParticipant *rtc.CallParticipant, resultErr error) {
	if r.mediaSlotGuard {
		defer func() { resultErr = slotLegacyError(resultErr) }()
	}
	spec := slotSpec{call: mustParseUUID(participant.CallID), user: mustParseUUID(participant.UserID)}
	if r.mediaSlotGuard && (spec.call == uuid.Nil || spec.user == uuid.Nil) {
		return nil, nil, rtc.ErrInvalidArgument
	}
	tx, slot, err := r.beginLegacySlot(ctx, spec)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := r.queries.WithTx(tx)
	if slot != nil {
		defer rollbackMedia(tx)
		if err := slot.allowLegacyJoin(spec); err != nil {
			return nil, nil, err
		}
	}
	locked, err := slotLockedCall(ctx, q, slot, mustParseUUID(participant.CallID))
	if err != nil {
		return nil, nil, convertError(err)
	}
	if locked.Status != rtc.CallStatusActive {
		return nil, nil, rtc.ErrConflict
	}
	row, err := q.GetActiveParticipantByCallIDAndUserID(ctx, rtcsqlc.GetActiveParticipantByCallIDAndUserIDParams{
		CallID: mustParseUUID(participant.CallID), UserID: mustParseUUID(participant.UserID),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		if err := q.ReleaseEndedParticipationByUserID(ctx, rtcsqlc.ReleaseEndedParticipationByUserIDParams{
			UserID: mustParseUUID(participant.UserID), At: timestamptzValue(participant.UpdatedAt),
		}); err != nil {
			return nil, nil, convertError(err)
		}
		row, err = q.CreateParticipant(ctx, rtcsqlc.CreateParticipantParams{
			ID:        mustParseUUID(participant.ID),
			CallID:    mustParseUUID(participant.CallID),
			UserID:    mustParseUUID(participant.UserID),
			State:     participant.State,
			JoinedAt:  timestamptzValue(participant.JoinedAt),
			UpdatedAt: timestamptzValue(participant.UpdatedAt),
		})
	}
	if err != nil {
		return nil, nil, convertError(err)
	}
	count, err := q.CountActiveParticipantsByCallID(ctx, locked.ID)
	if err != nil {
		return nil, nil, convertError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	call := toDomainCallFromBase(locked)
	call.ActiveParticipantCount = uint32(count)
	result := toDomainParticipant(row)
	return call, &result, nil
}

func (r *Repository) LeaveParticipantAndMaybeEndCall(ctx context.Context, callID, participantID string, at time.Time) (result bool, resultErr error) {
	if r.mediaSlotGuard {
		defer func() { resultErr = slotLegacyError(resultErr) }()
	}
	if r.mediaSlotGuard && (mustParseUUID(callID) == uuid.Nil || mustParseUUID(participantID) == uuid.Nil) {
		return false, rtc.ErrInvalidArgument
	}
	tx, slot, err := r.beginLegacySlot(ctx, slotSpec{call: mustParseUUID(callID), participant: mustParseUUID(participantID)})
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := r.queries.WithTx(tx)
	if slot != nil {
		defer rollbackMedia(tx)
		if err := slot.allowLegacyRelease(); err != nil {
			return false, err
		}
	}
	call, err := slotLockedCall(ctx, q, slot, mustParseUUID(callID))
	if err != nil {
		return false, convertError(err)
	}
	rows, err := q.ListActiveParticipantsByCallID(ctx, call.ID)
	if err != nil {
		return false, convertError(err)
	}
	found := false
	for _, row := range rows {
		if row.ID.String() == participantID {
			found = true
			break
		}
	}
	if !found {
		return false, nil
	}
	if _, err := q.LeaveParticipant(ctx, rtcsqlc.LeaveParticipantParams{ID: mustParseUUID(participantID), LeftAt: timestamptzValue(at), UpdatedAt: timestamptzValue(at)}); err != nil {
		return false, convertError(err)
	}
	count, err := q.CountActiveParticipantsByCallID(ctx, call.ID)
	if err != nil {
		return false, convertError(err)
	}
	if count == 0 {
		if _, err := q.EndCall(ctx, rtcsqlc.EndCallParams{ID: call.ID, UpdatedAt: timestamptzValue(at), EndedAt: timestamptzValue(at), EndReason: textPointerValue(stringPointer(rtc.CallEndReasonLastParticipant))}); err != nil {
			return false, convertError(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func (r *Repository) EndCallWithParticipants(ctx context.Context, callID, userID string, at time.Time) (resultCall *rtc.Call, resultParticipants []rtc.CallParticipant, resultErr error) {
	if r.mediaSlotGuard {
		defer func() { resultErr = slotLegacyError(resultErr) }()
	}
	if r.mediaSlotGuard && (mustParseUUID(callID) == uuid.Nil || mustParseUUID(userID) == uuid.Nil) {
		return nil, nil, rtc.ErrInvalidArgument
	}
	tx, slot, err := r.beginLegacySlot(ctx, slotSpec{call: mustParseUUID(callID), end: true})
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := r.queries.WithTx(tx)
	if slot != nil {
		defer rollbackMedia(tx)
	}
	call, err := slotLockedCall(ctx, q, slot, mustParseUUID(callID))
	if err != nil {
		return nil, nil, convertError(err)
	}
	if call.Status != rtc.CallStatusActive {
		return nil, nil, rtc.ErrConflict
	}
	if call.CreatedByUserID.String() != userID {
		return nil, nil, rtc.ErrPermissionDenied
	}
	if slot != nil {
		if err := slot.allowLegacyRelease(); err != nil {
			return nil, nil, err
		}
	}
	rows, err := q.ListActiveParticipantsByCallID(ctx, call.ID)
	if err != nil {
		return nil, nil, convertError(err)
	}
	if _, err := q.LeaveActiveParticipantsByCallID(ctx, rtcsqlc.LeaveActiveParticipantsByCallIDParams{CallID: call.ID, LeftAt: timestamptzValue(at), UpdatedAt: timestamptzValue(at)}); err != nil {
		return nil, nil, convertError(err)
	}
	if _, err := q.EndCall(ctx, rtcsqlc.EndCallParams{ID: call.ID, UpdatedAt: timestamptzValue(at), EndedAt: timestamptzValue(at), EndedByUserID: uuidValue(userID), EndReason: textPointerValue(stringPointer(rtc.CallEndReasonManual))}); err != nil {
		return nil, nil, convertError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	result := toDomainCallFromBase(call)
	result.Status = rtc.CallStatusEnded
	result.UpdatedAt, result.EndedAt, result.EndedByUserID, result.EndReason = at, &at, &userID, rtc.CallEndReasonManual
	affected := make([]rtc.CallParticipant, 0, len(rows))
	for _, row := range rows {
		participant := toDomainParticipant(row)
		participant.State, participant.LeftAt, participant.UpdatedAt = rtc.ParticipantStateLeft, &at, at
		affected = append(affected, participant)
	}
	return result, affected, nil
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

func (r *Repository) TouchParticipantSignal(ctx context.Context, participantID string, at time.Time) error {
	_, err := r.queries.TouchParticipantSignal(ctx, rtcsqlc.TouchParticipantSignalParams{
		LastSignalAt: timestamptzValue(at),
		UpdatedAt:    timestamptzValue(at),
		ID:           mustParseUUID(participantID),
	})

	return convertError(err)
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
