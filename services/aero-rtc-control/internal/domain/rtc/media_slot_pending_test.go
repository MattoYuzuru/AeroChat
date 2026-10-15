package rtc

import (
	"context"
	"errors"
	"testing"
	"time"
)

type pendingSlotRepository struct {
	*fakeRepository
	leaves int
}

func (r *pendingSlotRepository) LeaveParticipantAndMaybeEndCall(context.Context, string, string, time.Time) (bool, error) {
	r.leaves++
	return false, ErrMediaCleanupPending
}
func (r *pendingSlotRepository) EndCallWithParticipants(context.Context, string, string, time.Time) (*Call, []CallParticipant, error) {
	return nil, nil, ErrMediaCleanupPending
}

func TestMediaSlotPendingPropagatesThroughLegacyStalePaths(t *testing.T) {
	for _, action := range []string{"get_active", "get_call", "start", "join", "leave", "end", "list", "touch", "signal"} {
		t.Run(action, func(t *testing.T) {
			repo := &pendingSlotRepository{fakeRepository: newFakeRepository()}
			user, other, callID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"
			ownScope := ConversationScope{Type: ScopeTypeDirect, DirectChatID: "44444444-4444-4444-4444-444444444444"}
			nextScope := ConversationScope{Type: ScopeTypeDirect, DirectChatID: "55555555-5555-5555-5555-555555555555"}
			now := time.Now().UTC()
			old := now.Add(-2 * time.Minute)
			repo.calls[callID] = &Call{ID: callID, Scope: ownScope, CreatedByUserID: user, Status: CallStatusActive, CreatedAt: old, StartedAt: old, UpdatedAt: old}
			repo.addActiveParticipant("66666666-6666-6666-6666-666666666666", callID, user, old)
			repo.addActiveParticipant("77777777-7777-7777-7777-777777777777", callID, other, old)
			service := NewService(repo, &fakeAuthenticator{userID: user}, &fakeScopeAuthorizer{accessByScope: map[string]*ScopeAccess{scopeKey(ownScope): {Scope: ownScope}, scopeKey(nextScope): {Scope: nextScope}}}, 1024)
			service.now = func() time.Time { return now }
			var err error
			switch action {
			case "get_active":
				_, err = service.GetActiveCall(context.Background(), "token", ownScope)
			case "get_call":
				_, err = service.GetCall(context.Background(), "token", callID)
			case "start":
				_, _, err = service.StartCall(context.Background(), "token", nextScope)
			case "join":
				_, _, err = service.JoinCall(context.Background(), "token", callID)
			case "leave":
				_, _, err = service.LeaveCall(context.Background(), "token", callID)
			case "end":
				_, _, err = service.EndCall(context.Background(), "token", callID)
			case "list":
				_, err = service.ListCallParticipants(context.Background(), "token", callID)
			case "touch":
				_, err = service.TouchCallParticipant(context.Background(), "token", callID)
			case "signal":
				_, err = service.SendSignal(context.Background(), "token", callID, other, SignalTypeOffer, []byte("bounded"))
			}
			if !errors.Is(err, ErrMediaCleanupPending) || repo.leaves == 0 {
				t.Fatalf("action=%s err=%v leaves=%d", action, err, repo.leaves)
			}
			if len(repo.calls) != 1 || repo.calls[callID].Status != CallStatusActive {
				t.Fatal("pending stale path created/ended call")
			}
			for _, participant := range repo.participants {
				if participant.State != ParticipantStateActive || participant.LastSignalAt != nil {
					t.Fatal("pending stale path freed/touched participation")
				}
			}
		})
	}
}

func TestMediaSlotPendingDeniedTargetNeverForwardsSignal(t *testing.T) {
	repo := &pendingSlotRepository{fakeRepository: newFakeRepository()}
	user, other, callID := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"
	scope := ConversationScope{Type: ScopeTypeGroup, GroupID: "44444444-4444-4444-4444-444444444444"}
	now := time.Now().UTC()
	repo.calls[callID] = &Call{ID: callID, Scope: scope, CreatedByUserID: user, Status: CallStatusActive, CreatedAt: now, StartedAt: now, UpdatedAt: now}
	repo.addActiveParticipant("66666666-6666-6666-6666-666666666666", callID, user, now)
	repo.addActiveParticipant("77777777-7777-7777-7777-777777777777", callID, other, now)
	service := NewService(repo, &fakeAuthenticator{userID: user}, &fakeScopeAuthorizer{accessByScope: map[string]*ScopeAccess{scopeKey(scope): {Scope: scope, GroupRole: GroupRoleMember}}, participantError: ErrPermissionDenied}, 1024)
	service.now = func() time.Time { return now }
	envelope, err := service.SendSignal(context.Background(), "token", callID, other, SignalTypeOffer, []byte("bounded"))
	if envelope != nil || !errors.Is(err, ErrMediaCleanupPending) || repo.leaves != 1 {
		t.Fatal("denied target forwarded with pending cleanup", err)
	}
	for _, participant := range repo.participants {
		if participant.State != ParticipantStateActive || participant.LastSignalAt != nil {
			t.Fatal("denied pending target changed slot/signaling activity")
		}
	}
}
