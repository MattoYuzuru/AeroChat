package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	identitysqlc "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/storage/sqlc"
)

type Repository struct {
	db      *pgxpool.Pool
	queries *identitysqlc.Queries
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{
		db:      db,
		queries: identitysqlc.New(db),
	}
}

func (r *Repository) Ping(ctx context.Context) error {
	return r.db.Ping(ctx)
}

func (r *Repository) CreateAccount(ctx context.Context, params identity.CreateAccountParams) (*identity.AuthSession, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)

	userRow, err := q.CreateUser(ctx, identitysqlc.CreateUserParams{
		ID:                      mustParseUUID(params.User.ID),
		Login:                   params.User.Login,
		Nickname:                params.User.Nickname,
		AvatarUrl:               textValue(params.User.AvatarURL),
		Bio:                     textValue(params.User.Bio),
		Timezone:                textValue(params.User.Timezone),
		ProfileAccent:           textValue(params.User.ProfileAccent),
		StatusText:              textValue(params.User.StatusText),
		Birthday:                dateValue(params.User.Birthday),
		Country:                 textValue(params.User.Country),
		City:                    textValue(params.User.City),
		ReadReceiptsEnabled:     params.User.ReadReceiptsEnabled,
		PresenceEnabled:         params.User.PresenceEnabled,
		TypingVisibilityEnabled: params.User.TypingVisibilityEnabled,
		KeyBackupStatus:         params.User.KeyBackupStatus,
		CreatedAt:               timestampValue(params.User.CreatedAt),
		UpdatedAt:               timestampValue(params.User.UpdatedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	if err := q.CreateUserPasswordCredential(ctx, identitysqlc.CreateUserPasswordCredentialParams{
		UserID:       mustParseUUID(params.User.ID),
		PasswordHash: params.PasswordHash,
		CreatedAt:    timestampValue(params.User.CreatedAt),
		UpdatedAt:    timestampValue(params.User.UpdatedAt),
	}); err != nil {
		return nil, convertError(err)
	}

	deviceRow, err := q.CreateDevice(ctx, identitysqlc.CreateDeviceParams{
		ID:         mustParseUUID(params.Device.ID),
		UserID:     mustParseUUID(params.Device.UserID),
		Label:      params.Device.Label,
		CreatedAt:  timestampValue(params.Device.CreatedAt),
		LastSeenAt: timestampValue(params.Device.LastSeenAt),
		RevokedAt:  timestamptzValue(params.Device.RevokedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	sessionRow, err := q.CreateSession(ctx, identitysqlc.CreateSessionParams{
		ID:         mustParseUUID(params.Session.ID),
		UserID:     mustParseUUID(params.Session.UserID),
		DeviceID:   mustParseUUID(params.Session.DeviceID),
		TokenHash:  params.TokenHash,
		CreatedAt:  timestampValue(params.Session.CreatedAt),
		LastSeenAt: timestampValue(params.Session.LastSeenAt),
		RevokedAt:  timestamptzValue(params.Session.RevokedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	return &identity.AuthSession{
		User:    toDomainUser(userRow),
		Device:  toDomainDevice(deviceRow),
		Session: toDomainSession(sessionRow),
	}, nil
}

func (r *Repository) GetPasswordCredentialByLogin(ctx context.Context, login string) (*identity.PasswordCredential, error) {
	row, err := r.queries.GetPasswordCredentialByLogin(ctx, login)
	if err != nil {
		return nil, convertError(err)
	}

	return &identity.PasswordCredential{
		User: identity.User{
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
		PasswordHash: row.PasswordHash,
	}, nil
}

func (r *Repository) CreateSession(ctx context.Context, params identity.CreateSessionParams) (*identity.AuthSession, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)

	deviceRow, err := q.CreateDevice(ctx, identitysqlc.CreateDeviceParams{
		ID:         mustParseUUID(params.Device.ID),
		UserID:     mustParseUUID(params.UserID),
		Label:      params.Device.Label,
		CreatedAt:  timestampValue(params.Device.CreatedAt),
		LastSeenAt: timestampValue(params.Device.LastSeenAt),
		RevokedAt:  timestamptzValue(params.Device.RevokedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	sessionRow, err := q.CreateSession(ctx, identitysqlc.CreateSessionParams{
		ID:         mustParseUUID(params.Session.ID),
		UserID:     mustParseUUID(params.UserID),
		DeviceID:   mustParseUUID(params.Device.ID),
		TokenHash:  params.TokenHash,
		CreatedAt:  timestampValue(params.Session.CreatedAt),
		LastSeenAt: timestampValue(params.Session.LastSeenAt),
		RevokedAt:  timestamptzValue(params.Session.RevokedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	userRow, err := q.GetUserByID(ctx, mustParseUUID(params.UserID))
	if err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	return &identity.AuthSession{
		User:    toDomainUser(userRow),
		Device:  toDomainDevice(deviceRow),
		Session: toDomainSession(sessionRow),
	}, nil
}

func (r *Repository) GetSessionAuthByID(ctx context.Context, sessionID string) (*identity.SessionAuth, error) {
	row, err := r.queries.GetSessionAuthByID(ctx, mustParseUUID(sessionID))
	if err != nil {
		return nil, convertError(err)
	}

	return &identity.SessionAuth{
		User: identity.User{
			ID:                      row.UserID.String(),
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
			CreatedAt:               timestampPointer(row.UserCreatedAt),
			UpdatedAt:               timestampPointer(row.UserUpdatedAt),
		},
		Device: identity.Device{
			ID:         row.DeviceID.String(),
			UserID:     row.DeviceUserID.String(),
			Label:      row.DeviceLabel,
			CreatedAt:  timestampPointer(row.DeviceCreatedAt),
			LastSeenAt: timestampPointer(row.DeviceLastSeenAt),
			RevokedAt:  timestamptzPointer(row.DeviceRevokedAt),
		},
		Session: identity.Session{
			ID:         row.SessionID.String(),
			UserID:     row.SessionUserID.String(),
			DeviceID:   row.SessionDeviceID.String(),
			CreatedAt:  timestampPointer(row.SessionCreatedAt),
			LastSeenAt: timestampPointer(row.SessionLastSeenAt),
			RevokedAt:  timestamptzPointer(row.SessionRevokedAt),
		},
		TokenHash: row.TokenHash,
	}, nil
}

func (r *Repository) TouchSession(ctx context.Context, sessionID string, deviceID string, at time.Time) error {
	return r.queries.TouchSessionAndDevice(ctx, identitysqlc.TouchSessionAndDeviceParams{
		ID:         mustParseUUID(sessionID),
		DeviceID:   mustParseUUID(deviceID),
		LastSeenAt: timestampValue(at),
	})
}

func (r *Repository) UpdateUserProfile(ctx context.Context, user identity.User) (*identity.User, error) {
	row, err := r.queries.UpdateUserProfile(ctx, identitysqlc.UpdateUserProfileParams{
		ID:                      mustParseUUID(user.ID),
		Nickname:                user.Nickname,
		AvatarUrl:               textValue(user.AvatarURL),
		Bio:                     textValue(user.Bio),
		Timezone:                textValue(user.Timezone),
		ProfileAccent:           textValue(user.ProfileAccent),
		StatusText:              textValue(user.StatusText),
		Birthday:                dateValue(user.Birthday),
		Country:                 textValue(user.Country),
		City:                    textValue(user.City),
		ReadReceiptsEnabled:     user.ReadReceiptsEnabled,
		PresenceEnabled:         user.PresenceEnabled,
		TypingVisibilityEnabled: user.TypingVisibilityEnabled,
		KeyBackupStatus:         user.KeyBackupStatus,
		UpdatedAt:               timestampValue(user.UpdatedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	updated := toDomainUser(row)
	return &updated, nil
}

func (r *Repository) RevokeSession(ctx context.Context, userID string, sessionID string, at time.Time) (bool, error) {
	affected, err := r.queries.RevokeSession(ctx, identitysqlc.RevokeSessionParams{
		ID:     mustParseUUID(sessionID),
		UserID: mustParseUUID(userID),
		RevokedAt: pgtype.Timestamptz{
			Time:  at,
			Valid: true,
		},
	})
	if err != nil {
		return false, convertError(err)
	}

	return affected > 0, nil
}

func (r *Repository) RevokeDevice(ctx context.Context, userID string, deviceID string, at time.Time) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	revokedAt := pgtype.Timestamptz{Time: at, Valid: true}

	affected, err := q.RevokeDevice(ctx, identitysqlc.RevokeDeviceParams{
		ID:        mustParseUUID(deviceID),
		UserID:    mustParseUUID(userID),
		RevokedAt: revokedAt,
	})
	if err != nil {
		return false, convertError(err)
	}
	if affected == 0 {
		return false, nil
	}

	if err := q.RevokeDeviceSessions(ctx, identitysqlc.RevokeDeviceSessionsParams{
		DeviceID:  mustParseUUID(deviceID),
		UserID:    mustParseUUID(userID),
		RevokedAt: revokedAt,
	}); err != nil {
		return false, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}

	return true, nil
}

func (r *Repository) ListDevices(ctx context.Context, userID string) ([]identity.DeviceWithSessions, error) {
	deviceRows, err := r.queries.ListDevicesByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	sessionRows, err := r.queries.ListSessionsByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	devices := make([]identity.DeviceWithSessions, 0, len(deviceRows))
	deviceIndex := make(map[string]int, len(deviceRows))
	for index, row := range deviceRows {
		device := identity.DeviceWithSessions{Device: toDomainDevice(row)}
		devices = append(devices, device)
		deviceIndex[device.Device.ID] = index
	}

	for _, row := range sessionRows {
		session := toDomainSession(row)
		index, ok := deviceIndex[session.DeviceID]
		if !ok {
			continue
		}
		devices[index].Sessions = append(devices[index].Sessions, session)
	}

	return devices, nil
}

func (r *Repository) GetUserByLogin(ctx context.Context, login string) (*identity.User, error) {
	row, err := r.queries.GetUserByLogin(ctx, login)
	if err != nil {
		return nil, convertError(err)
	}

	user := toDomainUser(row)
	return &user, nil
}

func (r *Repository) ListBlockedUsers(ctx context.Context, userID string) ([]identity.BlockedUser, error) {
	rows, err := r.queries.ListBlockedUsersByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]identity.BlockedUser, 0, len(rows))
	for _, row := range rows {
		result = append(result, identity.BlockedUser{
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
			BlockedAt: timestampPointer(row.BlockedAt),
		})
	}

	return result, nil
}

func (r *Repository) BlockUser(ctx context.Context, blockerUserID string, blockedUserID string, createdAt time.Time) error {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	userLowID, userHighID := identity.CanonicalUserPair(blockerUserID, blockedUserID)
	q := r.queries.WithTx(tx)

	if err := q.DeleteFriendRequestsByPair(ctx, identitysqlc.DeleteFriendRequestsByPairParams{
		UserLowID:  mustParseUUID(userLowID),
		UserHighID: mustParseUUID(userHighID),
	}); err != nil {
		return convertError(err)
	}

	if _, err := q.DeleteFriendshipByPair(ctx, identitysqlc.DeleteFriendshipByPairParams{
		UserLowID:  mustParseUUID(userLowID),
		UserHighID: mustParseUUID(userHighID),
	}); err != nil {
		return convertError(err)
	}

	if err := q.CreateUserBlock(ctx, identitysqlc.CreateUserBlockParams{
		BlockerUserID: mustParseUUID(blockerUserID),
		BlockedUserID: mustParseUUID(blockedUserID),
		CreatedAt:     timestampValue(createdAt),
	}); err != nil {
		return convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}

	return nil
}

func (r *Repository) UnblockUser(ctx context.Context, blockerUserID string, blockedUserID string) (bool, error) {
	affected, err := r.queries.DeleteUserBlock(ctx, identitysqlc.DeleteUserBlockParams{
		BlockerUserID: mustParseUUID(blockerUserID),
		BlockedUserID: mustParseUUID(blockedUserID),
	})
	if err != nil {
		return false, convertError(err)
	}

	return affected > 0, nil
}

func toDomainUser(row identitysqlc.User) identity.User {
	return identity.User{
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
	}
}

func toDomainDevice(row identitysqlc.UserDevice) identity.Device {
	return identity.Device{
		ID:         row.ID.String(),
		UserID:     row.UserID.String(),
		Label:      row.Label,
		CreatedAt:  timestampPointer(row.CreatedAt),
		LastSeenAt: timestampPointer(row.LastSeenAt),
		RevokedAt:  timestamptzPointer(row.RevokedAt),
	}
}

func toDomainSession(row identitysqlc.UserSession) identity.Session {
	return identity.Session{
		ID:         row.ID.String(),
		UserID:     row.UserID.String(),
		DeviceID:   row.DeviceID.String(),
		CreatedAt:  timestampPointer(row.CreatedAt),
		LastSeenAt: timestampPointer(row.LastSeenAt),
		RevokedAt:  timestamptzPointer(row.RevokedAt),
	}
}

func textValue(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}

	return pgtype.Text{String: *value, Valid: true}
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}

	return &value.String
}

func dateValue(value *time.Time) pgtype.Date {
	if value == nil {
		return pgtype.Date{}
	}

	return pgtype.Date{Time: *value, Valid: true}
}

func datePointer(value pgtype.Date) *time.Time {
	if !value.Valid {
		return nil
	}

	date := value.Time.UTC()
	return &date
}

func timestamptzValue(value *time.Time) pgtype.Timestamptz {
	if value == nil {
		return pgtype.Timestamptz{}
	}

	return pgtype.Timestamptz{Time: *value, Valid: true}
}

func timestampValue(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{
		Time:  value.UTC(),
		Valid: true,
	}
}

func timestampPointer(value pgtype.Timestamptz) time.Time {
	if !value.Valid {
		return time.Time{}
	}

	return value.Time.UTC()
}

func timestamptzPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}

	timestamp := value.Time.UTC()
	return &timestamp
}

func mustParseUUID(value string) uuid.UUID {
	parsed, err := uuid.Parse(value)
	if err != nil {
		panic(fmt.Sprintf("invalid uuid %q: %v", value, err))
	}

	return parsed
}

func convertError(err error) error {
	if err == nil {
		return nil
	}

	if errors.Is(err, pgx.ErrNoRows) {
		return identity.ErrNotFound
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if pgErr.Code == "23505" {
			if pgErr.ConstraintName == "users_login_key" {
				return identity.ErrLoginTaken
			}
			return identity.ErrConflict
		}
	}

	return err
}
