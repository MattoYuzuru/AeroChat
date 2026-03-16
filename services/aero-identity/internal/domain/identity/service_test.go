package identity

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	identityauth "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/auth"
)

func TestRegisterAndLoginFlow(t *testing.T) {
	t.Parallel()

	service := newTestService()

	authSession, err := service.Register(context.Background(), RegisterInput{
		Login:    " Alice.Test ",
		Password: "CorrectHorseBatteryStaple1",
		Nickname: "Alice",
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}

	if authSession.User.Login != "alice.test" {
		t.Fatalf("ожидался нормализованный login, получен %q", authSession.User.Login)
	}
	if authSession.Token == "" {
		t.Fatal("ожидался session token после регистрации")
	}

	if _, err := service.Login(context.Background(), LoginInput{
		Login:    "alice.test",
		Password: "wrong-password",
	}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("ожидалась ошибка неверного пароля, получено %v", err)
	}

	secondAuth, err := service.Login(context.Background(), LoginInput{
		Login:    "ALICE.TEST",
		Password: "CorrectHorseBatteryStaple1",
	})
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	if secondAuth.User.ID != authSession.User.ID {
		t.Fatal("логин должен возвращать того же пользователя")
	}
	if secondAuth.Session.ID == authSession.Session.ID {
		t.Fatal("логин должен создавать новую сессию")
	}
}

func TestGetAndUpdateCurrentProfile(t *testing.T) {
	t.Parallel()

	service := newTestService()
	authSession := mustRegister(t, service, "profile-user", "Profile User")

	updated, err := service.UpdateCurrentProfile(context.Background(), authSession.Token, ProfilePatch{
		AvatarURL:               strPtr(" https://cdn.example/avatar.png "),
		Bio:                     strPtr("  bio  "),
		StatusText:              strPtr(" online "),
		Birthday:                strPtr("2001-02-03"),
		ReadReceiptsEnabled:     boolPtr(false),
		TypingVisibilityEnabled: boolPtr(false),
	})
	if err != nil {
		t.Fatalf("update profile: %v", err)
	}

	if updated.AvatarURL == nil || *updated.AvatarURL != "https://cdn.example/avatar.png" {
		t.Fatal("avatar_url должен сохраниться после обновления")
	}
	if updated.ReadReceiptsEnabled {
		t.Fatal("read receipts должны обновиться в false")
	}
	if updated.TypingVisibilityEnabled {
		t.Fatal("typing visibility должен обновиться в false")
	}
	if updated.Birthday == nil || updated.Birthday.Format("2006-01-02") != "2001-02-03" {
		t.Fatal("birthday должен сохраниться в ISO-формате")
	}

	profile, err := service.GetCurrentProfile(context.Background(), authSession.Token)
	if err != nil {
		t.Fatalf("get profile: %v", err)
	}
	if profile.StatusText == nil || *profile.StatusText != "online" {
		t.Fatal("ожидался обновлённый status_text")
	}
}

func TestListDevicesAndRevokeTargets(t *testing.T) {
	t.Parallel()

	service := newTestService()
	firstAuth := mustRegister(t, service, "device-user", "Device User")
	secondAuth, err := service.Login(context.Background(), LoginInput{
		Login:    "device-user",
		Password: "CorrectHorseBatteryStaple1",
	})
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	devices, err := service.ListDevices(context.Background(), firstAuth.Token)
	if err != nil {
		t.Fatalf("list devices: %v", err)
	}
	if len(devices) != 2 {
		t.Fatalf("ожидалось 2 устройства, получено %d", len(devices))
	}

	if err := service.RevokeSessionOrDevice(context.Background(), firstAuth.Token, SessionTarget{
		SessionID: &secondAuth.Session.ID,
	}); err != nil {
		t.Fatalf("revoke session: %v", err)
	}

	if _, err := service.GetCurrentProfile(context.Background(), secondAuth.Token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("ожидалась revoked session ошибка, получено %v", err)
	}

	if err := service.RevokeSessionOrDevice(context.Background(), firstAuth.Token, SessionTarget{
		DeviceID: &firstAuth.Device.ID,
	}); err != nil {
		t.Fatalf("revoke device: %v", err)
	}

	if _, err := service.GetCurrentProfile(context.Background(), firstAuth.Token); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("ожидалась revoked device ошибка, получено %v", err)
	}
}

func TestBlockAndUnblockUser(t *testing.T) {
	t.Parallel()

	service := newTestService()
	blocker := mustRegister(t, service, "blocker-user", "Blocker")
	target := mustRegister(t, service, "target-user", "Target")

	if err := service.BlockUser(context.Background(), blocker.Token, " TARGET-USER "); err != nil {
		t.Fatalf("block user: %v", err)
	}

	blockedUsers, err := service.ListBlockedUsers(context.Background(), blocker.Token)
	if err != nil {
		t.Fatalf("list blocked users: %v", err)
	}
	if len(blockedUsers) != 1 || blockedUsers[0].Profile.ID != target.User.ID {
		t.Fatal("ожидался один заблокированный пользователь")
	}

	if err := service.UnblockUser(context.Background(), blocker.Token, "target-user"); err != nil {
		t.Fatalf("unblock user: %v", err)
	}

	blockedUsers, err = service.ListBlockedUsers(context.Background(), blocker.Token)
	if err != nil {
		t.Fatalf("list blocked users after unblock: %v", err)
	}
	if len(blockedUsers) != 0 {
		t.Fatal("после unblock список должен быть пустым")
	}
}

func newTestService() *Service {
	repo := newFakeRepository()
	service := NewService(repo, identityauth.NewPasswordHasher(), identityauth.NewSessionTokenManager())
	now := time.Date(2026, 3, 16, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time {
		now = now.Add(time.Second)
		return now
	}

	sequence := 0
	service.newID = func() string {
		sequence++
		return testUUID(sequence)
	}

	return service
}

func mustRegister(t *testing.T, service *Service, login string, nickname string) *AuthSession {
	t.Helper()

	authSession, err := service.Register(context.Background(), RegisterInput{
		Login:    login,
		Password: "CorrectHorseBatteryStaple1",
		Nickname: nickname,
	})
	if err != nil {
		t.Fatalf("register %s: %v", login, err)
	}

	return authSession
}

type fakeRepository struct {
	users        map[string]User
	usersByLogin map[string]string
	passwords    map[string]string
	devices      map[string]Device
	sessions     map[string]SessionAuth
	blocks       map[string]map[string]time.Time
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		users:        make(map[string]User),
		usersByLogin: make(map[string]string),
		passwords:    make(map[string]string),
		devices:      make(map[string]Device),
		sessions:     make(map[string]SessionAuth),
		blocks:       make(map[string]map[string]time.Time),
	}
}

func (r *fakeRepository) CreateAccount(_ context.Context, params CreateAccountParams) (*AuthSession, error) {
	if _, exists := r.usersByLogin[params.User.Login]; exists {
		return nil, ErrLoginTaken
	}

	r.users[params.User.ID] = params.User
	r.usersByLogin[params.User.Login] = params.User.ID
	r.passwords[params.User.ID] = params.PasswordHash
	r.devices[params.Device.ID] = params.Device
	r.sessions[params.Session.ID] = SessionAuth{
		User:      params.User,
		Device:    params.Device,
		Session:   params.Session,
		TokenHash: params.TokenHash,
	}

	return &AuthSession{User: params.User, Device: params.Device, Session: params.Session}, nil
}

func (r *fakeRepository) GetPasswordCredentialByLogin(_ context.Context, login string) (*PasswordCredential, error) {
	userID, ok := r.usersByLogin[login]
	if !ok {
		return nil, ErrInvalidCredentials
	}

	return &PasswordCredential{
		User:         r.users[userID],
		PasswordHash: r.passwords[userID],
	}, nil
}

func (r *fakeRepository) CreateSession(_ context.Context, params CreateSessionParams) (*AuthSession, error) {
	user, ok := r.users[params.UserID]
	if !ok {
		return nil, ErrNotFound
	}

	r.devices[params.Device.ID] = params.Device
	r.sessions[params.Session.ID] = SessionAuth{
		User:      user,
		Device:    params.Device,
		Session:   params.Session,
		TokenHash: params.TokenHash,
	}

	return &AuthSession{User: user, Device: params.Device, Session: params.Session}, nil
}

func (r *fakeRepository) GetSessionAuthByID(_ context.Context, sessionID string) (*SessionAuth, error) {
	session, ok := r.sessions[sessionID]
	if !ok {
		return nil, ErrNotFound
	}

	copy := session
	return &copy, nil
}

func (r *fakeRepository) TouchSession(_ context.Context, sessionID string, deviceID string, at time.Time) error {
	session, ok := r.sessions[sessionID]
	if !ok {
		return ErrNotFound
	}
	device, ok := r.devices[deviceID]
	if !ok {
		return ErrNotFound
	}

	session.Session.LastSeenAt = at
	device.LastSeenAt = at
	r.devices[deviceID] = device
	session.Device = device
	r.sessions[sessionID] = session
	return nil
}

func (r *fakeRepository) UpdateUserProfile(_ context.Context, user User) (*User, error) {
	r.users[user.ID] = user
	for sessionID, session := range r.sessions {
		if session.User.ID != user.ID {
			continue
		}
		session.User = user
		r.sessions[sessionID] = session
	}
	updated := user
	return &updated, nil
}

func (r *fakeRepository) RevokeSession(_ context.Context, userID string, sessionID string, at time.Time) (bool, error) {
	session, ok := r.sessions[sessionID]
	if !ok || session.User.ID != userID || session.Session.RevokedAt != nil {
		return false, nil
	}

	session.Session.RevokedAt = &at
	r.sessions[sessionID] = session
	return true, nil
}

func (r *fakeRepository) RevokeDevice(_ context.Context, userID string, deviceID string, at time.Time) (bool, error) {
	device, ok := r.devices[deviceID]
	if !ok || device.UserID != userID || device.RevokedAt != nil {
		return false, nil
	}

	device.RevokedAt = &at
	r.devices[deviceID] = device
	for sessionID, session := range r.sessions {
		if session.Device.ID == deviceID && session.User.ID == userID {
			session.Device = device
			session.Session.RevokedAt = &at
			r.sessions[sessionID] = session
		}
	}

	return true, nil
}

func (r *fakeRepository) ListDevices(_ context.Context, userID string) ([]DeviceWithSessions, error) {
	items := []DeviceWithSessions{}
	index := map[string]int{}
	for _, device := range r.devices {
		if device.UserID != userID {
			continue
		}
		index[device.ID] = len(items)
		items = append(items, DeviceWithSessions{Device: device})
	}
	for _, session := range r.sessions {
		if session.User.ID != userID {
			continue
		}
		deviceIndex, ok := index[session.Device.ID]
		if !ok {
			continue
		}
		items[deviceIndex].Sessions = append(items[deviceIndex].Sessions, session.Session)
	}

	return items, nil
}

func (r *fakeRepository) GetUserByLogin(_ context.Context, login string) (*User, error) {
	userID, ok := r.usersByLogin[login]
	if !ok {
		return nil, ErrNotFound
	}

	user := r.users[userID]
	return &user, nil
}

func (r *fakeRepository) ListBlockedUsers(_ context.Context, userID string) ([]BlockedUser, error) {
	blockedSet := r.blocks[userID]
	result := make([]BlockedUser, 0, len(blockedSet))
	for blockedID, blockedAt := range blockedSet {
		result = append(result, BlockedUser{
			Profile:   r.users[blockedID],
			BlockedAt: blockedAt,
		})
	}

	return result, nil
}

func (r *fakeRepository) BlockUser(_ context.Context, blockerID string, blockedID string, createdAt time.Time) error {
	if r.blocks[blockerID] == nil {
		r.blocks[blockerID] = make(map[string]time.Time)
	}
	r.blocks[blockerID][blockedID] = createdAt
	return nil
}

func (r *fakeRepository) UnblockUser(_ context.Context, blockerID string, blockedID string) (bool, error) {
	blockedSet := r.blocks[blockerID]
	if blockedSet == nil {
		return false, nil
	}
	if _, ok := blockedSet[blockedID]; !ok {
		return false, nil
	}

	delete(blockedSet, blockedID)
	return true, nil
}

func strPtr(value string) *string {
	return &value
}

func boolPtr(value bool) *bool {
	return &value
}

func testUUID(sequence int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", sequence)
}
