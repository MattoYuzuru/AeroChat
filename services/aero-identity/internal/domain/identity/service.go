package identity

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	identityauth "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/auth"
	"github.com/google/uuid"
)

var loginPattern = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)

const (
	minPasswordLength = 8
	maxPasswordLength = 128
	maxAvatarURLLen   = 2048
	maxBioLen         = 500
	maxTimezoneLen    = 64
	maxAccentLen      = 64
	maxStatusTextLen  = 140
	maxCountryLen     = 64
	maxCityLen        = 64
	maxDeviceLabelLen = 120
	maxNicknameLen    = 64
	defaultDeviceName = "Текущее устройство"
)

type Repository interface {
	CreateAccount(context.Context, CreateAccountParams) (*AuthSession, error)
	GetPasswordCredentialByLogin(context.Context, string) (*PasswordCredential, error)
	CreateSession(context.Context, CreateSessionParams) (*AuthSession, error)
	GetSessionAuthByID(context.Context, string) (*SessionAuth, error)
	TouchSession(context.Context, string, string, time.Time) error
	UpdateUserProfile(context.Context, User) (*User, error)
	RevokeSession(context.Context, string, string, time.Time) (bool, error)
	RevokeDevice(context.Context, string, string, time.Time) (bool, error)
	ListDevices(context.Context, string) ([]DeviceWithSessions, error)
	GetUserByLogin(context.Context, string) (*User, error)
	ListBlockedUsers(context.Context, string) ([]BlockedUser, error)
	GetSocialGraphState(context.Context, string, string) (*SocialGraphState, error)
	CreateFriendRequest(context.Context, string, string, time.Time) error
	AcceptFriendRequest(context.Context, string, string, time.Time) (bool, error)
	DeleteFriendRequest(context.Context, string, string) (bool, error)
	ListIncomingFriendRequests(context.Context, string) ([]FriendRequest, error)
	ListOutgoingFriendRequests(context.Context, string) ([]FriendRequest, error)
	ListFriends(context.Context, string) ([]Friend, error)
	DeleteFriendship(context.Context, string, string) (bool, error)
	BlockUser(context.Context, string, string, time.Time) error
	UnblockUser(context.Context, string, string) (bool, error)
}

type Service struct {
	repo         Repository
	passwords    *identityauth.PasswordHasher
	sessionToken *identityauth.SessionTokenManager
	now          func() time.Time
	newID        func() string
}

func NewService(repo Repository, passwords *identityauth.PasswordHasher, sessionToken *identityauth.SessionTokenManager) *Service {
	return &Service{
		repo:         repo,
		passwords:    passwords,
		sessionToken: sessionToken,
		now: func() time.Time {
			return time.Now().UTC()
		},
		newID: func() string {
			return uuid.NewString()
		},
	}
}

func (s *Service) Register(ctx context.Context, input RegisterInput) (*AuthSession, error) {
	login, err := normalizeLogin(input.Login)
	if err != nil {
		return nil, err
	}

	nickname, err := normalizeNickname(input.Nickname)
	if err != nil {
		return nil, err
	}

	if err := validatePassword(input.Password); err != nil {
		return nil, err
	}

	deviceLabel, err := normalizeDeviceLabel(input.DeviceLabel)
	if err != nil {
		return nil, err
	}

	passwordHash, err := s.passwords.Hash(input.Password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	now := s.now()
	user := User{
		ID:                      s.newID(),
		Login:                   login,
		Nickname:                nickname,
		ReadReceiptsEnabled:     true,
		PresenceEnabled:         true,
		TypingVisibilityEnabled: true,
		KeyBackupStatus:         KeyBackupStatusNotConfigured,
		CreatedAt:               now,
		UpdatedAt:               now,
	}
	device := Device{
		ID:         s.newID(),
		UserID:     user.ID,
		Label:      deviceLabel,
		CreatedAt:  now,
		LastSeenAt: now,
	}
	session := Session{
		ID:         s.newID(),
		UserID:     user.ID,
		DeviceID:   device.ID,
		CreatedAt:  now,
		LastSeenAt: now,
	}

	token, tokenHash, err := s.sessionToken.Issue(session.ID)
	if err != nil {
		return nil, fmt.Errorf("issue session token: %w", err)
	}

	authSession, err := s.repo.CreateAccount(ctx, CreateAccountParams{
		User:         user,
		PasswordHash: passwordHash,
		Device:       device,
		Session:      session,
		TokenHash:    tokenHash,
	})
	if err != nil {
		return nil, err
	}

	authSession.Token = token
	return authSession, nil
}

func (s *Service) Login(ctx context.Context, input LoginInput) (*AuthSession, error) {
	login, err := normalizeLogin(input.Login)
	if err != nil {
		return nil, err
	}

	if input.Password == "" {
		return nil, fmt.Errorf("%w: password is required", ErrInvalidArgument)
	}

	deviceLabel, err := normalizeDeviceLabel(input.DeviceLabel)
	if err != nil {
		return nil, err
	}

	credential, err := s.repo.GetPasswordCredentialByLogin(ctx, login)
	if err != nil {
		return nil, err
	}

	valid, err := s.passwords.Verify(input.Password, credential.PasswordHash)
	if err != nil {
		return nil, fmt.Errorf("verify password: %w", err)
	}
	if !valid {
		return nil, ErrInvalidCredentials
	}

	now := s.now()
	device := Device{
		ID:         s.newID(),
		UserID:     credential.User.ID,
		Label:      deviceLabel,
		CreatedAt:  now,
		LastSeenAt: now,
	}
	session := Session{
		ID:         s.newID(),
		UserID:     credential.User.ID,
		DeviceID:   device.ID,
		CreatedAt:  now,
		LastSeenAt: now,
	}

	token, tokenHash, err := s.sessionToken.Issue(session.ID)
	if err != nil {
		return nil, fmt.Errorf("issue session token: %w", err)
	}

	authSession, err := s.repo.CreateSession(ctx, CreateSessionParams{
		UserID:    credential.User.ID,
		Device:    device,
		Session:   session,
		TokenHash: tokenHash,
	})
	if err != nil {
		return nil, err
	}

	authSession.Token = token
	return authSession, nil
}

func (s *Service) LogoutCurrentSession(ctx context.Context, token string) error {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return err
	}

	_, err = s.repo.RevokeSession(ctx, authSession.User.ID, authSession.Session.ID, s.now())
	return err
}

func (s *Service) GetCurrentProfile(ctx context.Context, token string) (*User, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	user := authSession.User
	return &user, nil
}

func (s *Service) UpdateCurrentProfile(ctx context.Context, token string, patch ProfilePatch) (*User, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	user := authSession.User
	if patch.Nickname != nil {
		nickname, normalizeErr := normalizeNickname(*patch.Nickname)
		if normalizeErr != nil {
			return nil, normalizeErr
		}
		user.Nickname = nickname
	}

	updatedUser, err := applyProfilePatch(user, patch)
	if err != nil {
		return nil, err
	}
	updatedUser.UpdatedAt = s.now()

	return s.repo.UpdateUserProfile(ctx, updatedUser)
}

func (s *Service) ListDevices(ctx context.Context, token string) ([]DeviceWithSessions, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	return s.repo.ListDevices(ctx, authSession.User.ID)
}

func (s *Service) RevokeSessionOrDevice(ctx context.Context, token string, target SessionTarget) error {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return err
	}

	at := s.now()
	switch {
	case target.SessionID != nil:
		ok, revokeErr := s.repo.RevokeSession(ctx, authSession.User.ID, strings.TrimSpace(*target.SessionID), at)
		if revokeErr != nil {
			return revokeErr
		}
		if !ok {
			return ErrNotFound
		}
		return nil
	case target.DeviceID != nil:
		ok, revokeErr := s.repo.RevokeDevice(ctx, authSession.User.ID, strings.TrimSpace(*target.DeviceID), at)
		if revokeErr != nil {
			return revokeErr
		}
		if !ok {
			return ErrNotFound
		}
		return nil
	default:
		return fmt.Errorf("%w: revoke target is required", ErrInvalidArgument)
	}
}

func (s *Service) ListBlockedUsers(ctx context.Context, token string) ([]BlockedUser, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	return s.repo.ListBlockedUsers(ctx, authSession.User.ID)
}

func (s *Service) BlockUser(ctx context.Context, token string, login string) error {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return err
	}

	targetLogin, err := normalizeLogin(login)
	if err != nil {
		return err
	}
	if targetLogin == authSession.User.Login {
		return fmt.Errorf("%w: self-block is not allowed", ErrConflict)
	}

	target, err := s.repo.GetUserByLogin(ctx, targetLogin)
	if err != nil {
		return err
	}

	return s.repo.BlockUser(ctx, authSession.User.ID, target.ID, s.now())
}

func (s *Service) UnblockUser(ctx context.Context, token string, login string) error {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return err
	}

	targetLogin, err := normalizeLogin(login)
	if err != nil {
		return err
	}

	target, err := s.repo.GetUserByLogin(ctx, targetLogin)
	if err != nil {
		return err
	}

	_, err = s.repo.UnblockUser(ctx, authSession.User.ID, target.ID)
	return err
}

func (s *Service) authenticate(ctx context.Context, token string) (*SessionAuth, error) {
	parsed, err := s.sessionToken.Parse(token)
	if err != nil {
		return nil, ErrUnauthorized
	}

	authSession, err := s.repo.GetSessionAuthByID(ctx, parsed.SessionID)
	if err != nil {
		return nil, err
	}

	if authSession.Session.RevokedAt != nil || authSession.Device.RevokedAt != nil {
		return nil, ErrUnauthorized
	}

	if subtle.ConstantTimeCompare([]byte(authSession.TokenHash), []byte(parsed.TokenHash)) != 1 {
		return nil, ErrUnauthorized
	}

	touchedAt := s.now()
	if err := s.repo.TouchSession(ctx, authSession.Session.ID, authSession.Device.ID, touchedAt); err != nil {
		return nil, err
	}

	authSession.Session.LastSeenAt = touchedAt
	authSession.Device.LastSeenAt = touchedAt

	return authSession, nil
}

func applyProfilePatch(user User, patch ProfilePatch) (User, error) {
	updated := user

	if patch.AvatarURL != nil {
		value, err := normalizeOptionalString(*patch.AvatarURL, maxAvatarURLLen)
		if err != nil {
			return User{}, fmt.Errorf("%w: avatar_url: %v", ErrInvalidArgument, err)
		}
		updated.AvatarURL = value
	}
	if patch.Bio != nil {
		value, err := normalizeOptionalString(*patch.Bio, maxBioLen)
		if err != nil {
			return User{}, fmt.Errorf("%w: bio: %v", ErrInvalidArgument, err)
		}
		updated.Bio = value
	}
	if patch.Timezone != nil {
		value, err := normalizeOptionalString(*patch.Timezone, maxTimezoneLen)
		if err != nil {
			return User{}, fmt.Errorf("%w: timezone: %v", ErrInvalidArgument, err)
		}
		updated.Timezone = value
	}
	if patch.ProfileAccent != nil {
		value, err := normalizeOptionalString(*patch.ProfileAccent, maxAccentLen)
		if err != nil {
			return User{}, fmt.Errorf("%w: profile_accent: %v", ErrInvalidArgument, err)
		}
		updated.ProfileAccent = value
	}
	if patch.StatusText != nil {
		value, err := normalizeOptionalString(*patch.StatusText, maxStatusTextLen)
		if err != nil {
			return User{}, fmt.Errorf("%w: status_text: %v", ErrInvalidArgument, err)
		}
		updated.StatusText = value
	}
	if patch.Birthday != nil {
		value, err := normalizeBirthday(*patch.Birthday)
		if err != nil {
			return User{}, err
		}
		updated.Birthday = value
	}
	if patch.Country != nil {
		value, err := normalizeOptionalString(*patch.Country, maxCountryLen)
		if err != nil {
			return User{}, fmt.Errorf("%w: country: %v", ErrInvalidArgument, err)
		}
		updated.Country = value
	}
	if patch.City != nil {
		value, err := normalizeOptionalString(*patch.City, maxCityLen)
		if err != nil {
			return User{}, fmt.Errorf("%w: city: %v", ErrInvalidArgument, err)
		}
		updated.City = value
	}
	if patch.ReadReceiptsEnabled != nil {
		updated.ReadReceiptsEnabled = *patch.ReadReceiptsEnabled
	}
	if patch.PresenceEnabled != nil {
		updated.PresenceEnabled = *patch.PresenceEnabled
	}
	if patch.TypingVisibilityEnabled != nil {
		updated.TypingVisibilityEnabled = *patch.TypingVisibilityEnabled
	}

	return updated, nil
}

func normalizeLogin(login string) (string, error) {
	value := strings.ToLower(strings.TrimSpace(login))
	if !loginPattern.MatchString(value) {
		return "", fmt.Errorf("%w: login must match ^[a-z0-9._-]{3,32}$", ErrInvalidArgument)
	}

	return value, nil
}

func normalizeNickname(nickname string) (string, error) {
	value := strings.TrimSpace(nickname)
	if value == "" || len([]rune(value)) > maxNicknameLen {
		return "", fmt.Errorf("%w: nickname must be between 1 and 64 characters", ErrInvalidArgument)
	}

	return value, nil
}

func validatePassword(password string) error {
	if len(password) < minPasswordLength || len(password) > maxPasswordLength {
		return fmt.Errorf("%w: password must be between 8 and 128 characters", ErrInvalidArgument)
	}

	return nil
}

func normalizeDeviceLabel(label *string) (string, error) {
	if label == nil {
		return defaultDeviceName, nil
	}

	value := strings.TrimSpace(*label)
	if value == "" {
		return defaultDeviceName, nil
	}
	if len([]rune(value)) > maxDeviceLabelLen {
		return "", fmt.Errorf("%w: device label is too long", ErrInvalidArgument)
	}

	return value, nil
}

func normalizeOptionalString(value string, maxLen int) (*string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}
	if len([]rune(trimmed)) > maxLen {
		return nil, errors.New("value is too long")
	}

	return &trimmed, nil
}

func normalizeBirthday(value string) (*time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}

	parsed, err := time.Parse("2006-01-02", trimmed)
	if err != nil {
		return nil, fmt.Errorf("%w: birthday must use YYYY-MM-DD", ErrInvalidArgument)
	}

	parsed = parsed.UTC()
	return &parsed, nil
}
