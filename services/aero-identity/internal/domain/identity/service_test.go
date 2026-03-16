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

func TestFriendRequestAcceptFlow(t *testing.T) {
	t.Parallel()

	service := newTestService()
	alice := mustRegister(t, service, "alice-user", "Alice")
	bob := mustRegister(t, service, "bob-user", "Bob")

	if err := service.SendFriendRequest(context.Background(), alice.Token, " BOB-USER "); err != nil {
		t.Fatalf("send friend request: %v", err)
	}

	incoming, err := service.ListIncomingFriendRequests(context.Background(), bob.Token)
	if err != nil {
		t.Fatalf("list incoming friend requests: %v", err)
	}
	if len(incoming) != 1 || incoming[0].Profile.ID != alice.User.ID {
		t.Fatal("ожидался один входящий friend request от Alice")
	}

	outgoing, err := service.ListOutgoingFriendRequests(context.Background(), alice.Token)
	if err != nil {
		t.Fatalf("list outgoing friend requests: %v", err)
	}
	if len(outgoing) != 1 || outgoing[0].Profile.ID != bob.User.ID {
		t.Fatal("ожидался один исходящий friend request к Bob")
	}

	if err := service.AcceptFriendRequest(context.Background(), bob.Token, "alice-user"); err != nil {
		t.Fatalf("accept friend request: %v", err)
	}

	incoming, err = service.ListIncomingFriendRequests(context.Background(), bob.Token)
	if err != nil {
		t.Fatalf("list incoming after accept: %v", err)
	}
	if len(incoming) != 0 {
		t.Fatal("после accept входящих заявок быть не должно")
	}

	friends, err := service.ListFriends(context.Background(), alice.Token)
	if err != nil {
		t.Fatalf("list friends for alice: %v", err)
	}
	if len(friends) != 1 || friends[0].Profile.ID != bob.User.ID {
		t.Fatal("Alice должна видеть Bob в списке друзей")
	}

	friends, err = service.ListFriends(context.Background(), bob.Token)
	if err != nil {
		t.Fatalf("list friends for bob: %v", err)
	}
	if len(friends) != 1 || friends[0].Profile.ID != alice.User.ID {
		t.Fatal("Bob должен видеть Alice в списке друзей")
	}
}

func TestDeclineCancelAndRemoveFriend(t *testing.T) {
	t.Parallel()

	service := newTestService()
	alice := mustRegister(t, service, "decline-alice", "Alice")
	bob := mustRegister(t, service, "decline-bob", "Bob")

	if err := service.SendFriendRequest(context.Background(), alice.Token, "decline-bob"); err != nil {
		t.Fatalf("send friend request for decline: %v", err)
	}
	if err := service.DeclineFriendRequest(context.Background(), bob.Token, "decline-alice"); err != nil {
		t.Fatalf("decline friend request: %v", err)
	}

	incoming, err := service.ListIncomingFriendRequests(context.Background(), bob.Token)
	if err != nil {
		t.Fatalf("list incoming after decline: %v", err)
	}
	if len(incoming) != 0 {
		t.Fatal("после decline список входящих должен быть пустым")
	}

	if err := service.SendFriendRequest(context.Background(), bob.Token, "decline-alice"); err != nil {
		t.Fatalf("send reverse friend request: %v", err)
	}
	if err := service.CancelOutgoingFriendRequest(context.Background(), bob.Token, "decline-alice"); err != nil {
		t.Fatalf("cancel outgoing friend request: %v", err)
	}

	outgoing, err := service.ListOutgoingFriendRequests(context.Background(), bob.Token)
	if err != nil {
		t.Fatalf("list outgoing after cancel: %v", err)
	}
	if len(outgoing) != 0 {
		t.Fatal("после cancel список исходящих должен быть пустым")
	}

	if err := service.SendFriendRequest(context.Background(), alice.Token, "decline-bob"); err != nil {
		t.Fatalf("send friend request before friendship: %v", err)
	}
	if err := service.AcceptFriendRequest(context.Background(), bob.Token, "decline-alice"); err != nil {
		t.Fatalf("accept friend request before remove: %v", err)
	}

	if err := service.RemoveFriend(context.Background(), alice.Token, "decline-bob"); err != nil {
		t.Fatalf("remove friend: %v", err)
	}

	friends, err := service.ListFriends(context.Background(), alice.Token)
	if err != nil {
		t.Fatalf("list friends after remove: %v", err)
	}
	if len(friends) != 0 {
		t.Fatal("после remove friend список друзей должен быть пустым")
	}
}

func TestSocialGraphRejectsInvalidOperations(t *testing.T) {
	t.Parallel()

	service := newTestService()
	alice := mustRegister(t, service, "graph-alice", "Alice")
	bob := mustRegister(t, service, "graph-bob", "Bob")

	if err := service.SendFriendRequest(context.Background(), alice.Token, "graph-alice"); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка self-friend operation, получено %v", err)
	}

	if err := service.SendFriendRequest(context.Background(), alice.Token, "graph-bob"); err != nil {
		t.Fatalf("send friend request: %v", err)
	}

	if err := service.SendFriendRequest(context.Background(), alice.Token, "graph-bob"); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка duplicate active request, получено %v", err)
	}

	if err := service.SendFriendRequest(context.Background(), bob.Token, "graph-alice"); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка incoming request already exists, получено %v", err)
	}

	if err := service.AcceptFriendRequest(context.Background(), bob.Token, "graph-alice"); err != nil {
		t.Fatalf("accept friend request: %v", err)
	}

	if err := service.SendFriendRequest(context.Background(), alice.Token, "graph-bob"); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка already friends, получено %v", err)
	}
}

func TestBlockClearsSocialGraphAndPreventsRequests(t *testing.T) {
	t.Parallel()

	service := newTestService()
	alice := mustRegister(t, service, "block-alice", "Alice")
	bob := mustRegister(t, service, "block-bob", "Bob")

	if err := service.SendFriendRequest(context.Background(), alice.Token, "block-bob"); err != nil {
		t.Fatalf("send friend request before block: %v", err)
	}

	if err := service.BlockUser(context.Background(), bob.Token, "block-alice"); err != nil {
		t.Fatalf("block user: %v", err)
	}

	incoming, err := service.ListIncomingFriendRequests(context.Background(), bob.Token)
	if err != nil {
		t.Fatalf("list incoming after block: %v", err)
	}
	if len(incoming) != 0 {
		t.Fatal("block должен очищать активные friend requests")
	}

	if err := service.SendFriendRequest(context.Background(), alice.Token, "block-bob"); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка blocked users cannot send requests, получено %v", err)
	}

	if err := service.UnblockUser(context.Background(), bob.Token, "block-alice"); err != nil {
		t.Fatalf("unblock user: %v", err)
	}

	if err := service.SendFriendRequest(context.Background(), alice.Token, "block-bob"); err != nil {
		t.Fatalf("send friend request after unblock: %v", err)
	}
	if err := service.AcceptFriendRequest(context.Background(), bob.Token, "block-alice"); err != nil {
		t.Fatalf("accept friend request after unblock: %v", err)
	}

	if err := service.BlockUser(context.Background(), bob.Token, "block-alice"); err != nil {
		t.Fatalf("block user after friendship: %v", err)
	}

	friends, err := service.ListFriends(context.Background(), bob.Token)
	if err != nil {
		t.Fatalf("list friends after friendship block: %v", err)
	}
	if len(friends) != 0 {
		t.Fatal("block должен разрывать существующую friendship")
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
	friendReqs   map[string]PendingFriendRequest
	friendships  map[string]time.Time
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		users:        make(map[string]User),
		usersByLogin: make(map[string]string),
		passwords:    make(map[string]string),
		devices:      make(map[string]Device),
		sessions:     make(map[string]SessionAuth),
		blocks:       make(map[string]map[string]time.Time),
		friendReqs:   make(map[string]PendingFriendRequest),
		friendships:  make(map[string]time.Time),
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

func (r *fakeRepository) GetSocialGraphState(_ context.Context, userID string, targetUserID string) (*SocialGraphState, error) {
	state := &SocialGraphState{
		HasBlock:   r.hasBlock(userID, targetUserID),
		AreFriends: r.areFriends(userID, targetUserID),
	}

	request, ok := r.friendReqs[pairKey(userID, targetUserID)]
	if ok {
		copy := request
		state.PendingRequest = &copy
	}

	return state, nil
}

func (r *fakeRepository) CreateFriendRequest(_ context.Context, requesterUserID string, addresseeUserID string, createdAt time.Time) error {
	r.friendReqs[pairKey(requesterUserID, addresseeUserID)] = PendingFriendRequest{
		RequesterUserID: requesterUserID,
		AddresseeUserID: addresseeUserID,
		CreatedAt:       createdAt,
	}
	return nil
}

func (r *fakeRepository) AcceptFriendRequest(_ context.Context, requesterUserID string, addresseeUserID string, createdAt time.Time) (bool, error) {
	key := pairKey(requesterUserID, addresseeUserID)
	request, ok := r.friendReqs[key]
	if !ok || request.RequesterUserID != requesterUserID || request.AddresseeUserID != addresseeUserID {
		return false, nil
	}

	delete(r.friendReqs, key)
	r.friendships[key] = createdAt
	return true, nil
}

func (r *fakeRepository) DeleteFriendRequest(_ context.Context, requesterUserID string, addresseeUserID string) (bool, error) {
	key := pairKey(requesterUserID, addresseeUserID)
	request, ok := r.friendReqs[key]
	if !ok || request.RequesterUserID != requesterUserID || request.AddresseeUserID != addresseeUserID {
		return false, nil
	}

	delete(r.friendReqs, key)
	return true, nil
}

func (r *fakeRepository) ListIncomingFriendRequests(_ context.Context, userID string) ([]FriendRequest, error) {
	result := make([]FriendRequest, 0)
	for _, request := range r.friendReqs {
		if request.AddresseeUserID != userID {
			continue
		}
		result = append(result, FriendRequest{
			Profile:     r.users[request.RequesterUserID],
			RequestedAt: request.CreatedAt,
		})
	}

	return result, nil
}

func (r *fakeRepository) ListOutgoingFriendRequests(_ context.Context, userID string) ([]FriendRequest, error) {
	result := make([]FriendRequest, 0)
	for _, request := range r.friendReqs {
		if request.RequesterUserID != userID {
			continue
		}
		result = append(result, FriendRequest{
			Profile:     r.users[request.AddresseeUserID],
			RequestedAt: request.CreatedAt,
		})
	}

	return result, nil
}

func (r *fakeRepository) ListFriends(_ context.Context, userID string) ([]Friend, error) {
	result := make([]Friend, 0)
	for key, since := range r.friendships {
		firstUserID, secondUserID := splitPairKey(key)
		friendUserID := ""
		switch userID {
		case firstUserID:
			friendUserID = secondUserID
		case secondUserID:
			friendUserID = firstUserID
		default:
			continue
		}

		result = append(result, Friend{
			Profile:      r.users[friendUserID],
			FriendsSince: since,
		})
	}

	return result, nil
}

func (r *fakeRepository) DeleteFriendship(_ context.Context, firstUserID string, secondUserID string) (bool, error) {
	key := pairKey(firstUserID, secondUserID)
	if _, ok := r.friendships[key]; !ok {
		return false, nil
	}

	delete(r.friendships, key)
	return true, nil
}

func (r *fakeRepository) BlockUser(_ context.Context, blockerID string, blockedID string, createdAt time.Time) error {
	if r.blocks[blockerID] == nil {
		r.blocks[blockerID] = make(map[string]time.Time)
	}
	r.blocks[blockerID][blockedID] = createdAt
	delete(r.friendReqs, pairKey(blockerID, blockedID))
	delete(r.friendships, pairKey(blockerID, blockedID))
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

func pairKey(firstUserID string, secondUserID string) string {
	userLowID, userHighID := CanonicalUserPair(firstUserID, secondUserID)
	return userLowID + ":" + userHighID
}

func splitPairKey(value string) (string, string) {
	for index := 0; index < len(value); index++ {
		if value[index] == ':' {
			return value[:index], value[index+1:]
		}
	}

	return "", ""
}

func (r *fakeRepository) hasBlock(firstUserID string, secondUserID string) bool {
	if blockedSet := r.blocks[firstUserID]; blockedSet != nil {
		if _, ok := blockedSet[secondUserID]; ok {
			return true
		}
	}
	if blockedSet := r.blocks[secondUserID]; blockedSet != nil {
		if _, ok := blockedSet[firstUserID]; ok {
			return true
		}
	}

	return false
}

func (r *fakeRepository) areFriends(firstUserID string, secondUserID string) bool {
	_, ok := r.friendships[pairKey(firstUserID, secondUserID)]
	return ok
}

func testUUID(sequence int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", sequence)
}
