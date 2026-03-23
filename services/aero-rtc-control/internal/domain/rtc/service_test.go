package rtc

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestStartCallCreatesAuthoritativeActiveCall(t *testing.T) {
	repo := newFakeRepository()
	service := NewService(
		repo,
		&fakeAuthenticator{userID: "11111111-1111-1111-1111-111111111111"},
		&fakeScopeAuthorizer{
			accessByScope: map[string]*ScopeAccess{
				"direct:22222222-2222-2222-2222-222222222222": {
					Scope: ConversationScope{Type: ScopeTypeDirect, DirectChatID: "22222222-2222-2222-2222-222222222222"},
				},
			},
		},
		16*1024,
	)

	call, participant, err := service.StartCall(context.Background(), "token", ConversationScope{
		Type:         ScopeTypeDirect,
		DirectChatID: "22222222-2222-2222-2222-222222222222",
	})
	if err != nil {
		t.Fatalf("start call: %v", err)
	}
	if call == nil || participant == nil {
		t.Fatal("ожидались созданные call и participant")
	}
	if call.Status != CallStatusActive {
		t.Fatalf("ожидался active status, получен %q", call.Status)
	}
	if call.ActiveParticipantCount != 1 {
		t.Fatalf("ожидался один активный participant, получено %d", call.ActiveParticipantCount)
	}
	if participant.UserID != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("ожидался participant текущего пользователя, получен %q", participant.UserID)
	}
}

func TestStartCallRejectsGroupReader(t *testing.T) {
	service := NewService(
		newFakeRepository(),
		&fakeAuthenticator{userID: "11111111-1111-1111-1111-111111111111"},
		&fakeScopeAuthorizer{
			accessByScope: map[string]*ScopeAccess{
				"group:33333333-3333-3333-3333-333333333333": {
					Scope:     ConversationScope{Type: ScopeTypeGroup, GroupID: "33333333-3333-3333-3333-333333333333"},
					GroupRole: GroupRoleReader,
				},
			},
		},
		16*1024,
	)

	_, _, err := service.StartCall(context.Background(), "token", ConversationScope{
		Type:    ScopeTypeGroup,
		GroupID: "33333333-3333-3333-3333-333333333333",
	})
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидался ErrPermissionDenied для reader, получено: %v", err)
	}
}

func TestStartCallRejectsUserAlreadyActiveInAnotherCall(t *testing.T) {
	repo := newFakeRepository()
	now := time.Date(2026, 3, 23, 10, 0, 0, 0, time.UTC)
	repo.calls["44444444-4444-4444-4444-444444444444"] = &Call{
		ID:              "44444444-4444-4444-4444-444444444444",
		Scope:           ConversationScope{Type: ScopeTypeDirect, DirectChatID: "55555555-5555-5555-5555-555555555555"},
		CreatedByUserID: "11111111-1111-1111-1111-111111111111",
		Status:          CallStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
		StartedAt:       now,
	}
	repo.addActiveParticipant("66666666-6666-6666-6666-666666666666", "44444444-4444-4444-4444-444444444444", "11111111-1111-1111-1111-111111111111", now)

	service := NewService(
		repo,
		&fakeAuthenticator{userID: "11111111-1111-1111-1111-111111111111"},
		&fakeScopeAuthorizer{
			accessByScope: map[string]*ScopeAccess{
				"direct:77777777-7777-7777-7777-777777777777": {
					Scope: ConversationScope{Type: ScopeTypeDirect, DirectChatID: "77777777-7777-7777-7777-777777777777"},
				},
			},
		},
		16*1024,
	)

	_, _, err := service.StartCall(context.Background(), "token", ConversationScope{
		Type:         ScopeTypeDirect,
		DirectChatID: "77777777-7777-7777-7777-777777777777",
	})

	var conflictErr *ActiveCallConflictError
	if !errors.As(err, &conflictErr) {
		t.Fatalf("ожидался ActiveCallConflictError, получено: %v", err)
	}
	if conflictErr.Call.ID != "44444444-4444-4444-4444-444444444444" {
		t.Fatalf("ожидался конфликтующий call 4444..., получен %q", conflictErr.Call.ID)
	}
}

func TestJoinCallRejectsUserAlreadyActiveInAnotherCall(t *testing.T) {
	repo := newFakeRepository()
	now := time.Date(2026, 3, 23, 10, 0, 0, 0, time.UTC)
	repo.calls["88888888-8888-8888-8888-888888888888"] = &Call{
		ID:              "88888888-8888-8888-8888-888888888888",
		Scope:           ConversationScope{Type: ScopeTypeDirect, DirectChatID: "99999999-9999-9999-9999-999999999999"},
		CreatedByUserID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		Status:          CallStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
		StartedAt:       now,
	}
	repo.calls["12121212-1212-1212-1212-121212121212"] = &Call{
		ID:              "12121212-1212-1212-1212-121212121212",
		Scope:           ConversationScope{Type: ScopeTypeGroup, GroupID: "34343434-3434-3434-3434-343434343434"},
		CreatedByUserID: "cccccccc-cccc-cccc-cccc-cccccccccccc",
		Status:          CallStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
		StartedAt:       now,
	}
	repo.addActiveParticipant("13131313-1313-1313-1313-131313131313", "88888888-8888-8888-8888-888888888888", "11111111-1111-1111-1111-111111111111", now)

	service := NewService(
		repo,
		&fakeAuthenticator{userID: "11111111-1111-1111-1111-111111111111"},
		&fakeScopeAuthorizer{
			accessByScope: map[string]*ScopeAccess{
				"group:34343434-3434-3434-3434-343434343434": {
					Scope:     ConversationScope{Type: ScopeTypeGroup, GroupID: "34343434-3434-3434-3434-343434343434"},
					GroupRole: GroupRoleMember,
				},
			},
		},
		16*1024,
	)

	_, _, err := service.JoinCall(context.Background(), "token", "12121212-1212-1212-1212-121212121212")

	var conflictErr *ActiveCallConflictError
	if !errors.As(err, &conflictErr) {
		t.Fatalf("ожидался ActiveCallConflictError, получено: %v", err)
	}
	if conflictErr.Call.ID != "88888888-8888-8888-8888-888888888888" {
		t.Fatalf("ожидался конфликтующий call 8888..., получен %q", conflictErr.Call.ID)
	}
}

func TestUserCanStartAnotherCallAfterLeavingPrevious(t *testing.T) {
	repo := newFakeRepository()
	now := time.Date(2026, 3, 23, 10, 0, 0, 0, time.UTC)
	repo.calls["15151515-1515-1515-1515-151515151515"] = &Call{
		ID:              "15151515-1515-1515-1515-151515151515",
		Scope:           ConversationScope{Type: ScopeTypeDirect, DirectChatID: "16161616-1616-1616-1616-161616161616"},
		CreatedByUserID: "11111111-1111-1111-1111-111111111111",
		Status:          CallStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
		StartedAt:       now,
	}
	repo.addActiveParticipant("17171717-1717-1717-1717-171717171717", "15151515-1515-1515-1515-151515151515", "11111111-1111-1111-1111-111111111111", now)

	service := NewService(
		repo,
		&fakeAuthenticator{userID: "11111111-1111-1111-1111-111111111111"},
		&fakeScopeAuthorizer{
			accessByScope: map[string]*ScopeAccess{
				"direct:16161616-1616-1616-1616-161616161616": {
					Scope: ConversationScope{Type: ScopeTypeDirect, DirectChatID: "16161616-1616-1616-1616-161616161616"},
				},
				"direct:18181818-1818-1818-1818-181818181818": {
					Scope: ConversationScope{Type: ScopeTypeDirect, DirectChatID: "18181818-1818-1818-1818-181818181818"},
				},
			},
		},
		16*1024,
	)

	if _, _, err := service.LeaveCall(context.Background(), "token", "15151515-1515-1515-1515-151515151515"); err != nil {
		t.Fatalf("leave call: %v", err)
	}

	call, participant, err := service.StartCall(context.Background(), "token", ConversationScope{
		Type:         ScopeTypeDirect,
		DirectChatID: "18181818-1818-1818-1818-181818181818",
	})
	if err != nil {
		t.Fatalf("start next call: %v", err)
	}
	if call == nil || participant == nil {
		t.Fatal("ожидался новый call после leave")
	}
}

func TestLeftParticipationHistoryDoesNotBlockFutureJoin(t *testing.T) {
	repo := newFakeRepository()
	now := time.Date(2026, 3, 23, 10, 0, 0, 0, time.UTC)
	leftAt := now.Add(2 * time.Minute)
	repo.calls["19191919-1919-1919-1919-191919191919"] = &Call{
		ID:              "19191919-1919-1919-1919-191919191919",
		Scope:           ConversationScope{Type: ScopeTypeDirect, DirectChatID: "20202020-2020-2020-2020-202020202020"},
		CreatedByUserID: "11111111-1111-1111-1111-111111111111",
		Status:          CallStatusEnded,
		CreatedAt:       now,
		UpdatedAt:       leftAt,
		StartedAt:       now,
		EndedAt:         &leftAt,
		EndReason:       CallEndReasonLastParticipant,
	}
	repo.participants["21212121-2121-2121-2121-212121212121"] = &CallParticipant{
		ID:        "21212121-2121-2121-2121-212121212121",
		CallID:    "19191919-1919-1919-1919-191919191919",
		UserID:    "11111111-1111-1111-1111-111111111111",
		State:     ParticipantStateLeft,
		JoinedAt:  now,
		LeftAt:    &leftAt,
		UpdatedAt: leftAt,
	}
	repo.calls["22222222-2222-2222-2222-222222222222"] = &Call{
		ID:              "22222222-2222-2222-2222-222222222222",
		Scope:           ConversationScope{Type: ScopeTypeGroup, GroupID: "23232323-2323-2323-2323-232323232323"},
		CreatedByUserID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		Status:          CallStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
		StartedAt:       now,
	}

	service := NewService(
		repo,
		&fakeAuthenticator{userID: "11111111-1111-1111-1111-111111111111"},
		&fakeScopeAuthorizer{
			accessByScope: map[string]*ScopeAccess{
				"group:23232323-2323-2323-2323-232323232323": {
					Scope:     ConversationScope{Type: ScopeTypeGroup, GroupID: "23232323-2323-2323-2323-232323232323"},
					GroupRole: GroupRoleMember,
				},
			},
		},
		16*1024,
	)

	call, participant, err := service.JoinCall(context.Background(), "token", "22222222-2222-2222-2222-222222222222")
	if err != nil {
		t.Fatalf("join call after left history: %v", err)
	}
	if call == nil || participant == nil {
		t.Fatal("ожидался успешный join без блокировки left history")
	}
}

func TestLeaveCallAutoEndsWhenLastParticipantLeaves(t *testing.T) {
	repo := newFakeRepository()
	now := time.Date(2026, 3, 23, 10, 0, 0, 0, time.UTC)
	repo.calls["44444444-4444-4444-4444-444444444444"] = &Call{
		ID:              "44444444-4444-4444-4444-444444444444",
		Scope:           ConversationScope{Type: ScopeTypeDirect, DirectChatID: "55555555-5555-5555-5555-555555555555"},
		CreatedByUserID: "11111111-1111-1111-1111-111111111111",
		Status:          CallStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
		StartedAt:       now,
	}
	repo.addActiveParticipant("66666666-6666-6666-6666-666666666666", "44444444-4444-4444-4444-444444444444", "11111111-1111-1111-1111-111111111111", now)

	service := NewService(
		repo,
		&fakeAuthenticator{userID: "11111111-1111-1111-1111-111111111111"},
		&fakeScopeAuthorizer{
			accessByScope: map[string]*ScopeAccess{
				"direct:55555555-5555-5555-5555-555555555555": {
					Scope: ConversationScope{Type: ScopeTypeDirect, DirectChatID: "55555555-5555-5555-5555-555555555555"},
				},
			},
		},
		16*1024,
	)

	call, participant, err := service.LeaveCall(context.Background(), "token", "44444444-4444-4444-4444-444444444444")
	if err != nil {
		t.Fatalf("leave call: %v", err)
	}
	if participant.State != ParticipantStateLeft {
		t.Fatalf("ожидался left state, получен %q", participant.State)
	}
	if call.Status != CallStatusEnded {
		t.Fatalf("ожидался ended call после ухода последнего participant, получен %q", call.Status)
	}
	if call.EndReason != CallEndReasonLastParticipant {
		t.Fatalf("ожидался auto-end reason %q, получен %q", CallEndReasonLastParticipant, call.EndReason)
	}
}

func TestEndCallRequiresCreator(t *testing.T) {
	repo := newFakeRepository()
	now := time.Date(2026, 3, 23, 10, 0, 0, 0, time.UTC)
	repo.calls["77777777-7777-7777-7777-777777777777"] = &Call{
		ID:              "77777777-7777-7777-7777-777777777777",
		Scope:           ConversationScope{Type: ScopeTypeGroup, GroupID: "88888888-8888-8888-8888-888888888888"},
		CreatedByUserID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
		Status:          CallStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
		StartedAt:       now,
	}

	service := NewService(
		repo,
		&fakeAuthenticator{userID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"},
		&fakeScopeAuthorizer{
			accessByScope: map[string]*ScopeAccess{
				"group:88888888-8888-8888-8888-888888888888": {
					Scope:     ConversationScope{Type: ScopeTypeGroup, GroupID: "88888888-8888-8888-8888-888888888888"},
					GroupRole: GroupRoleMember,
				},
			},
		},
		16*1024,
	)

	_, _, err := service.EndCall(context.Background(), "token", "77777777-7777-7777-7777-777777777777")
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидался ErrPermissionDenied для non-creator end call, получено: %v", err)
	}
}

func TestSendSignalRequiresActiveTargetAndBoundedPayload(t *testing.T) {
	repo := newFakeRepository()
	now := time.Date(2026, 3, 23, 10, 0, 0, 0, time.UTC)
	repo.calls["99999999-9999-9999-9999-999999999999"] = &Call{
		ID:              "99999999-9999-9999-9999-999999999999",
		Scope:           ConversationScope{Type: ScopeTypeDirect, DirectChatID: "12121212-1212-1212-1212-121212121212"},
		CreatedByUserID: "11111111-1111-1111-1111-111111111111",
		Status:          CallStatusActive,
		CreatedAt:       now,
		UpdatedAt:       now,
		StartedAt:       now,
	}
	repo.addActiveParticipant("13131313-1313-1313-1313-131313131313", "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111111", now)
	repo.addActiveParticipant("14141414-1414-1414-1414-141414141414", "99999999-9999-9999-9999-999999999999", "22222222-2222-2222-2222-222222222222", now)

	service := NewService(
		repo,
		&fakeAuthenticator{userID: "11111111-1111-1111-1111-111111111111"},
		&fakeScopeAuthorizer{
			accessByScope: map[string]*ScopeAccess{
				"direct:12121212-1212-1212-1212-121212121212": {
					Scope: ConversationScope{Type: ScopeTypeDirect, DirectChatID: "12121212-1212-1212-1212-121212121212"},
				},
			},
		},
		4,
	)

	if _, err := service.SendSignal(context.Background(), "token", "99999999-9999-9999-9999-999999999999", "22222222-2222-2222-2222-222222222222", SignalTypeOffer, []byte("12345")); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка bounded payload, получено: %v", err)
	}

	signal, err := service.SendSignal(context.Background(), "token", "99999999-9999-9999-9999-999999999999", "22222222-2222-2222-2222-222222222222", SignalTypeOffer, []byte("1234"))
	if err != nil {
		t.Fatalf("send signal: %v", err)
	}
	if signal.TargetUserID != "22222222-2222-2222-2222-222222222222" {
		t.Fatalf("ожидался target user 2222..., получен %q", signal.TargetUserID)
	}
}

type fakeAuthenticator struct {
	userID string
	err    error
}

func (f *fakeAuthenticator) Authenticate(context.Context, string) (*AuthenticatedUser, error) {
	if f.err != nil {
		return nil, f.err
	}

	return &AuthenticatedUser{ID: f.userID}, nil
}

type fakeScopeAuthorizer struct {
	accessByScope map[string]*ScopeAccess
}

func (f *fakeScopeAuthorizer) GetScopeAccess(_ context.Context, _ string, scope ConversationScope) (*ScopeAccess, error) {
	access, ok := f.accessByScope[scopeKey(scope)]
	if !ok {
		return nil, ErrPermissionDenied
	}

	return access, nil
}

type fakeRepository struct {
	calls        map[string]*Call
	participants map[string]*CallParticipant
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		calls:        make(map[string]*Call),
		participants: make(map[string]*CallParticipant),
	}
}

func (r *fakeRepository) GetCallByID(_ context.Context, callID string) (*Call, error) {
	call, ok := r.calls[callID]
	if !ok {
		return nil, ErrNotFound
	}

	return cloneCall(call), nil
}

func (r *fakeRepository) GetActiveCallByScope(_ context.Context, scope ConversationScope) (*Call, error) {
	for _, call := range r.calls {
		if call.Scope == scope && call.Status == CallStatusActive {
			return cloneCall(call), nil
		}
	}

	return nil, ErrNotFound
}

func (r *fakeRepository) CreateCallWithParticipant(_ context.Context, call Call, participant CallParticipant) (*Call, *CallParticipant, error) {
	for _, existing := range r.calls {
		if existing.Scope == call.Scope && existing.Status == CallStatusActive {
			return nil, nil, ErrConflict
		}
	}
	for _, existing := range r.participants {
		if existing.UserID == participant.UserID && existing.State == ParticipantStateActive {
			return nil, nil, ErrConflict
		}
	}

	call.ActiveParticipantCount = 1
	r.calls[call.ID] = cloneCall(&call)
	r.participants[participant.ID] = cloneParticipant(&participant)

	return cloneCall(&call), cloneParticipant(&participant), nil
}

func (r *fakeRepository) CreateParticipant(_ context.Context, participant CallParticipant) (*CallParticipant, error) {
	for _, existing := range r.participants {
		if existing.CallID == participant.CallID && existing.UserID == participant.UserID && existing.State == ParticipantStateActive {
			return nil, ErrConflict
		}
		if existing.UserID == participant.UserID && existing.State == ParticipantStateActive {
			return nil, ErrConflict
		}
	}

	r.participants[participant.ID] = cloneParticipant(&participant)
	r.recalculateCallActiveCount(participant.CallID)

	return cloneParticipant(&participant), nil
}

func (r *fakeRepository) GetActiveParticipant(_ context.Context, callID string, userID string) (*CallParticipant, error) {
	for _, participant := range r.participants {
		if participant.CallID == callID && participant.UserID == userID && participant.State == ParticipantStateActive {
			return cloneParticipant(participant), nil
		}
	}

	return nil, ErrNotFound
}

func (r *fakeRepository) GetActiveParticipationByUserID(_ context.Context, userID string) (*ActiveParticipation, error) {
	for _, participant := range r.participants {
		if participant.UserID != userID || participant.State != ParticipantStateActive {
			continue
		}

		call, ok := r.calls[participant.CallID]
		if !ok || call.Status != CallStatusActive {
			continue
		}

		return &ActiveParticipation{
			Call:        *cloneCall(call),
			Participant: *cloneParticipant(participant),
		}, nil
	}

	return nil, ErrNotFound
}

func (r *fakeRepository) ListActiveParticipants(_ context.Context, callID string) ([]CallParticipant, error) {
	result := make([]CallParticipant, 0)
	for _, participant := range r.participants {
		if participant.CallID == callID && participant.State == ParticipantStateActive {
			result = append(result, *cloneParticipant(participant))
		}
	}

	return result, nil
}

func (r *fakeRepository) LeaveParticipant(_ context.Context, participantID string, at time.Time) (bool, error) {
	participant, ok := r.participants[participantID]
	if !ok || participant.State != ParticipantStateActive {
		return false, nil
	}

	participant.State = ParticipantStateLeft
	participant.LeftAt = &at
	participant.UpdatedAt = at
	r.recalculateCallActiveCount(participant.CallID)

	return true, nil
}

func (r *fakeRepository) LeaveActiveParticipantsByCallID(_ context.Context, callID string, at time.Time) error {
	for _, participant := range r.participants {
		if participant.CallID == callID && participant.State == ParticipantStateActive {
			participant.State = ParticipantStateLeft
			participant.LeftAt = &at
			participant.UpdatedAt = at
		}
	}
	r.recalculateCallActiveCount(callID)

	return nil
}

func (r *fakeRepository) TouchParticipantSignal(_ context.Context, participantID string, at time.Time) error {
	participant, ok := r.participants[participantID]
	if !ok {
		return ErrNotFound
	}

	participant.LastSignalAt = &at
	participant.UpdatedAt = at
	return nil
}

func (r *fakeRepository) CountActiveParticipants(_ context.Context, callID string) (int64, error) {
	var count int64
	for _, participant := range r.participants {
		if participant.CallID == callID && participant.State == ParticipantStateActive {
			count++
		}
	}

	return count, nil
}

func (r *fakeRepository) EndCall(_ context.Context, callID string, endedByUserID *string, endReason string, at time.Time) (bool, error) {
	call, ok := r.calls[callID]
	if !ok || call.Status != CallStatusActive {
		return false, nil
	}

	call.Status = CallStatusEnded
	call.UpdatedAt = at
	call.EndedAt = &at
	call.EndedByUserID = endedByUserID
	call.EndReason = endReason
	r.recalculateCallActiveCount(callID)

	return true, nil
}

func (r *fakeRepository) addActiveParticipant(participantID string, callID string, userID string, joinedAt time.Time) {
	r.participants[participantID] = &CallParticipant{
		ID:        participantID,
		CallID:    callID,
		UserID:    userID,
		State:     ParticipantStateActive,
		JoinedAt:  joinedAt,
		UpdatedAt: joinedAt,
	}
	r.recalculateCallActiveCount(callID)
}

func (r *fakeRepository) recalculateCallActiveCount(callID string) {
	call, ok := r.calls[callID]
	if !ok {
		return
	}

	var count uint32
	for _, participant := range r.participants {
		if participant.CallID == callID && participant.State == ParticipantStateActive {
			count++
		}
	}
	call.ActiveParticipantCount = count
}

func cloneCall(call *Call) *Call {
	if call == nil {
		return nil
	}

	result := *call
	if call.EndedAt != nil {
		copyValue := *call.EndedAt
		result.EndedAt = &copyValue
	}
	if call.EndedByUserID != nil {
		copyValue := *call.EndedByUserID
		result.EndedByUserID = &copyValue
	}

	return &result
}

func cloneParticipant(participant *CallParticipant) *CallParticipant {
	if participant == nil {
		return nil
	}

	result := *participant
	if participant.LeftAt != nil {
		copyValue := *participant.LeftAt
		result.LeftAt = &copyValue
	}
	if participant.LastSignalAt != nil {
		copyValue := *participant.LastSignalAt
		result.LastSignalAt = &copyValue
	}

	return &result
}

func scopeKey(scope ConversationScope) string {
	switch scope.Type {
	case ScopeTypeDirect:
		return "direct:" + scope.DirectChatID
	case ScopeTypeGroup:
		return "group:" + scope.GroupID
	default:
		return scope.Type
	}
}
