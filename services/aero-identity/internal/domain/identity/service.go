package identity

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	identityauth "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/auth"
	"github.com/google/uuid"
)

var loginPattern = regexp.MustCompile(`^[a-z0-9._-]{3,32}$`)

const (
	minPasswordLength                      = 8
	maxPasswordLength                      = 128
	maxAvatarURLLen                        = 2048
	maxBioLen                              = 500
	maxTimezoneLen                         = 64
	maxAccentLen                           = 64
	maxStatusTextLen                       = 140
	maxCountryLen                          = 64
	maxCityLen                             = 64
	maxDeviceLabelLen                      = 120
	maxNicknameLen                         = 64
	defaultDeviceName                      = "Текущее устройство"
	defaultSessionTouchInterval            = 15 * time.Second
	defaultCryptoLinkIntentTTL             = 15 * time.Minute
	defaultCryptoBundlePublishChallengeTTL = 10 * time.Minute
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
	UpsertWebPushSubscription(context.Context, WebPushSubscription) error
	DeleteWebPushSubscription(context.Context, string, string) (bool, error)
	ListWebPushSubscriptions(context.Context, string) ([]WebPushSubscription, error)
	DeleteWebPushSubscriptionsByIDs(context.Context, []string) (int64, error)
	GetCryptoDeviceRegistryStatsByUserID(context.Context, string) (int64, int64, int64, error)
	CreateCryptoDevice(context.Context, CreateCryptoDeviceParams) (*CryptoDevice, *CryptoDeviceBundle, error)
	ListCryptoDevices(context.Context, string) ([]CryptoDevice, error)
	GetCryptoDeviceDetails(context.Context, string, string) (*CryptoDeviceDetails, error)
	CreateCryptoDeviceBundlePublishChallenge(context.Context, CreateCryptoDeviceBundlePublishChallengeParams) (*CryptoDeviceBundlePublishChallenge, error)
	PublishCryptoDeviceBundle(context.Context, string, PublishCryptoDeviceBundleInput, time.Time) (*CryptoDevice, *CryptoDeviceBundle, error)
	CreateCryptoDeviceLinkIntent(context.Context, CreateCryptoDeviceLinkIntentParams) (*CryptoDeviceLinkIntent, error)
	ListCryptoDeviceLinkIntents(context.Context, string, time.Time) ([]CryptoDeviceLinkIntent, error)
	ApproveCryptoDeviceLinkIntent(context.Context, ApproveCryptoDeviceLinkIntentParams) (*CryptoDeviceLinkIntent, *CryptoDevice, error)
	ExpireCryptoDeviceLinkIntent(context.Context, string, string, time.Time) (*CryptoDeviceLinkIntent, error)
	RevokeCryptoDevice(context.Context, RevokeCryptoDeviceParams) (*CryptoDevice, error)
}

type NotificationDispatcher interface {
	PublicKey() string
	DispatchFriendRequest(
		context.Context,
		User,
		User,
		[]WebPushSubscription,
		time.Time,
	) []string
}

type Service struct {
	repo                            Repository
	passwords                       *identityauth.PasswordHasher
	sessionToken                    *libauth.SessionTokenManager
	notificationDispatcher          NotificationDispatcher
	sessionTouchInterval            time.Duration
	cryptoLinkIntentTTL             time.Duration
	cryptoBundlePublishChallengeTTL time.Duration
	newCryptoLinkApprovalChallenge  func() ([]byte, error)
	newCryptoBundlePublishChallenge func() ([]byte, error)
	now                             func() time.Time
	newID                           func() string
}

func NewService(
	repo Repository,
	passwords *identityauth.PasswordHasher,
	sessionToken *libauth.SessionTokenManager,
	notificationDispatcher NotificationDispatcher,
) *Service {
	return &Service{
		repo:                            repo,
		passwords:                       passwords,
		sessionToken:                    sessionToken,
		notificationDispatcher:          notificationDispatcher,
		sessionTouchInterval:            defaultSessionTouchInterval,
		cryptoLinkIntentTTL:             defaultCryptoLinkIntentTTL,
		cryptoBundlePublishChallengeTTL: defaultCryptoBundlePublishChallengeTTL,
		newCryptoLinkApprovalChallenge: func() ([]byte, error) {
			challenge := make([]byte, 32)
			if _, err := rand.Read(challenge); err != nil {
				return nil, fmt.Errorf("read crypto link approval challenge: %w", err)
			}

			return challenge, nil
		},
		newCryptoBundlePublishChallenge: func() ([]byte, error) {
			challenge := make([]byte, 32)
			if _, err := rand.Read(challenge); err != nil {
				return nil, fmt.Errorf("read crypto bundle publish challenge: %w", err)
			}

			return challenge, nil
		},
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
		PushNotificationsEnabled: true,
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

func (s *Service) GetWebPushPublicKey() string {
	if s.notificationDispatcher == nil {
		return ""
	}

	return strings.TrimSpace(s.notificationDispatcher.PublicKey())
}

func (s *Service) UpsertWebPushSubscription(
	ctx context.Context,
	token string,
	input UpsertWebPushSubscriptionInput,
) error {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return err
	}

	endpoint, err := normalizeRequiredURLString(input.Endpoint, "endpoint")
	if err != nil {
		return err
	}
	p256dhKey, err := normalizeRequiredTokenString(input.P256DHKey, "p256dh_key", 512)
	if err != nil {
		return err
	}
	authSecret, err := normalizeRequiredTokenString(input.AuthSecret, "auth_secret", 512)
	if err != nil {
		return err
	}
	userAgent, err := normalizeOptionalString(valueOrEmptyString(input.UserAgent), 512)
	if err != nil {
		return fmt.Errorf("%w: user_agent: %v", ErrInvalidArgument, err)
	}

	now := s.now()
	return s.repo.UpsertWebPushSubscription(ctx, WebPushSubscription{
		ID:             s.newID(),
		UserID:         authSession.User.ID,
		Endpoint:       endpoint,
		P256DHKey:      p256dhKey,
		AuthSecret:     authSecret,
		ExpirationTime: input.ExpirationTime,
		UserAgent:      userAgent,
		CreatedAt:      now,
		UpdatedAt:      now,
	})
}

func (s *Service) DeleteWebPushSubscription(ctx context.Context, token string, endpoint string) error {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return err
	}

	normalizedEndpoint, err := normalizeRequiredURLString(endpoint, "endpoint")
	if err != nil {
		return err
	}

	_, err = s.repo.DeleteWebPushSubscription(ctx, authSession.User.ID, normalizedEndpoint)
	return err
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
	if shouldTouchSession(authSession.Session.LastSeenAt, touchedAt, s.sessionTouchInterval) ||
		shouldTouchSession(authSession.Device.LastSeenAt, touchedAt, s.sessionTouchInterval) {
		if err := s.repo.TouchSession(ctx, authSession.Session.ID, authSession.Device.ID, touchedAt); err != nil {
			return nil, err
		}

		authSession.Session.LastSeenAt = touchedAt
		authSession.Device.LastSeenAt = touchedAt
	}

	return authSession, nil
}

func shouldTouchSession(lastSeenAt time.Time, now time.Time, minInterval time.Duration) bool {
	if minInterval <= 0 {
		return true
	}
	if lastSeenAt.IsZero() {
		return true
	}

	return now.Sub(lastSeenAt) >= minInterval
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
	if patch.PushNotificationsEnabled != nil {
		updated.PushNotificationsEnabled = *patch.PushNotificationsEnabled
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

func valueOrEmptyString(value *string) string {
	if value == nil {
		return ""
	}

	return *value
}

func normalizeRequiredURLString(value string, field string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", fmt.Errorf("%w: %s is required", ErrInvalidArgument, field)
	}
	if len(trimmed) > 4096 {
		return "", fmt.Errorf("%w: %s is too long", ErrInvalidArgument, field)
	}

	return trimmed, nil
}

func normalizeRequiredTokenString(value string, field string, maxLen int) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", fmt.Errorf("%w: %s is required", ErrInvalidArgument, field)
	}
	if len(trimmed) > maxLen {
		return "", fmt.Errorf("%w: %s is too long", ErrInvalidArgument, field)
	}

	return trimmed, nil
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
