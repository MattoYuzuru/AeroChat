package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	identitysqlc "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/storage/sqlc"
)

func (r *Repository) GetSocialGraphState(ctx context.Context, userID string, targetUserID string) (*identity.SocialGraphState, error) {
	userLowID, userHighID := identity.CanonicalUserPair(userID, targetUserID)

	row, err := r.queries.GetSocialGraphState(ctx, identitysqlc.GetSocialGraphStateParams{
		BlockerUserID: mustParseUUID(userID),
		BlockedUserID: mustParseUUID(targetUserID),
		UserLowID:     mustParseUUID(userLowID),
		UserHighID:    mustParseUUID(userHighID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	state := &identity.SocialGraphState{
		HasBlock:   row.HasBlock,
		AreFriends: row.AreFriends,
	}
	if row.RequestCreatedAt.Valid && row.RequesterUserID != uuid.Nil && row.AddresseeUserID != uuid.Nil {
		state.PendingRequest = &identity.PendingFriendRequest{
			RequesterUserID: row.RequesterUserID.String(),
			AddresseeUserID: row.AddresseeUserID.String(),
			CreatedAt:       timestampPointer(row.RequestCreatedAt),
		}
	}

	return state, nil
}

func (r *Repository) CreateFriendRequest(ctx context.Context, requesterUserID string, addresseeUserID string, createdAt time.Time) error {
	userLowID, userHighID := identity.CanonicalUserPair(requesterUserID, addresseeUserID)

	return convertError(r.queries.CreateFriendRequest(ctx, identitysqlc.CreateFriendRequestParams{
		RequesterUserID: mustParseUUID(requesterUserID),
		AddresseeUserID: mustParseUUID(addresseeUserID),
		UserLowID:       mustParseUUID(userLowID),
		UserHighID:      mustParseUUID(userHighID),
		CreatedAt:       timestampValue(createdAt),
	}))
}

func (r *Repository) AcceptFriendRequest(ctx context.Context, requesterUserID string, addresseeUserID string, createdAt time.Time) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	userLowID, userHighID := identity.CanonicalUserPair(requesterUserID, addresseeUserID)
	q := r.queries.WithTx(tx)

	affected, err := q.DeleteFriendRequest(ctx, identitysqlc.DeleteFriendRequestParams{
		RequesterUserID: mustParseUUID(requesterUserID),
		AddresseeUserID: mustParseUUID(addresseeUserID),
	})
	if err != nil {
		return false, convertError(err)
	}
	if affected == 0 {
		return false, nil
	}

	if err := q.CreateFriendship(ctx, identitysqlc.CreateFriendshipParams{
		UserLowID:  mustParseUUID(userLowID),
		UserHighID: mustParseUUID(userHighID),
		CreatedAt:  timestampValue(createdAt),
	}); err != nil {
		return false, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}

	return true, nil
}

func (r *Repository) DeleteFriendRequest(ctx context.Context, requesterUserID string, addresseeUserID string) (bool, error) {
	affected, err := r.queries.DeleteFriendRequest(ctx, identitysqlc.DeleteFriendRequestParams{
		RequesterUserID: mustParseUUID(requesterUserID),
		AddresseeUserID: mustParseUUID(addresseeUserID),
	})
	if err != nil {
		return false, convertError(err)
	}

	return affected > 0, nil
}

func (r *Repository) ListIncomingFriendRequests(ctx context.Context, userID string) ([]identity.FriendRequest, error) {
	rows, err := r.queries.ListIncomingFriendRequestsByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]identity.FriendRequest, 0, len(rows))
	for _, row := range rows {
		result = append(result, toDomainFriendRequest(row))
	}

	return result, nil
}

func (r *Repository) ListOutgoingFriendRequests(ctx context.Context, userID string) ([]identity.FriendRequest, error) {
	rows, err := r.queries.ListOutgoingFriendRequestsByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]identity.FriendRequest, 0, len(rows))
	for _, row := range rows {
		result = append(result, toDomainFriendRequest(identitysqlc.ListIncomingFriendRequestsByUserIDRow(row)))
	}

	return result, nil
}

func (r *Repository) ListFriends(ctx context.Context, userID string) ([]identity.Friend, error) {
	rows, err := r.queries.ListFriendsByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]identity.Friend, 0, len(rows))
	for _, row := range rows {
		result = append(result, identity.Friend{
			Profile: identity.User{
				ID:                      row.ID.String(),
				Login:                   row.Login,
				Nickname:                row.Nickname,
				AvatarURL:               textPointer(row.AvatarUrl),
				Bio:                     textPointer(row.Bio),
				Timezone:                textPointer(row.Timezone),
				ProfileAccent:           textPointer(row.ProfileAccent),
				StatusText:              textPointer(row.StatusText),
				Birthday:                datePointer(row.Birthday),
				Country:                 textPointer(row.Country),
				City:                    textPointer(row.City),
				ReadReceiptsEnabled:     row.ReadReceiptsEnabled,
				PresenceEnabled:         row.PresenceEnabled,
				TypingVisibilityEnabled: row.TypingVisibilityEnabled,
				KeyBackupStatus:         row.KeyBackupStatus,
				CreatedAt:               timestampPointer(row.CreatedAt),
				UpdatedAt:               timestampPointer(row.UpdatedAt),
			},
			FriendsSince: timestampPointer(row.FriendsSince),
		})
	}

	return result, nil
}

func (r *Repository) DeleteFriendship(ctx context.Context, firstUserID string, secondUserID string) (bool, error) {
	userLowID, userHighID := identity.CanonicalUserPair(firstUserID, secondUserID)

	affected, err := r.queries.DeleteFriendshipByPair(ctx, identitysqlc.DeleteFriendshipByPairParams{
		UserLowID:  mustParseUUID(userLowID),
		UserHighID: mustParseUUID(userHighID),
	})
	if err != nil {
		return false, convertError(err)
	}

	return affected > 0, nil
}

func toDomainFriendRequest(row identitysqlc.ListIncomingFriendRequestsByUserIDRow) identity.FriendRequest {
	return identity.FriendRequest{
		Profile: identity.User{
			ID:                      row.ID.String(),
			Login:                   row.Login,
			Nickname:                row.Nickname,
			AvatarURL:               textPointer(row.AvatarUrl),
			Bio:                     textPointer(row.Bio),
			Timezone:                textPointer(row.Timezone),
			ProfileAccent:           textPointer(row.ProfileAccent),
			StatusText:              textPointer(row.StatusText),
			Birthday:                datePointer(row.Birthday),
			Country:                 textPointer(row.Country),
			City:                    textPointer(row.City),
			ReadReceiptsEnabled:     row.ReadReceiptsEnabled,
			PresenceEnabled:         row.PresenceEnabled,
			TypingVisibilityEnabled: row.TypingVisibilityEnabled,
			KeyBackupStatus:         row.KeyBackupStatus,
			CreatedAt:               timestampPointer(row.CreatedAt),
			UpdatedAt:               timestampPointer(row.UpdatedAt),
		},
		RequestedAt: timestampPointer(row.RequestedAt),
	}
}
