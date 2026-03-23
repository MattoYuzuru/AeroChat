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
