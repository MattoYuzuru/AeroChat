package rtc

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestSendSignalRevalidatesCurrentRecipientEligibility(t *testing.T) {
	for _, change := range []string{"removed", "reader", "unknown_role", "wrong_scope", "eligible", "unavailable"} {
		t.Run(change, func(t *testing.T) {
			repo := newFakeRepository()
			now := time.Now().UTC()
			scope := ConversationScope{Type: ScopeTypeGroup, GroupID: "33333333-3333-3333-3333-333333333333"}
			call := &Call{ID: "44444444-4444-4444-4444-444444444444", Scope: scope, Status: CallStatusActive, CreatedByUserID: "11111111-1111-1111-1111-111111111111", CreatedAt: now, StartedAt: now, UpdatedAt: now}
			repo.calls[call.ID] = call
			sender, target := "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
			repo.addActiveParticipant("55555555-5555-5555-5555-555555555555", call.ID, sender, now)
			repo.addActiveParticipant("66666666-6666-6666-6666-666666666666", call.ID, target, now)
			authorizer := &fakeScopeAuthorizer{accessByScope: map[string]*ScopeAccess{scopeKey(scope): {Scope: scope, GroupRole: GroupRoleMember}}, participantAccess: map[string]*ScopeAccess{target: {Scope: scope, GroupRole: GroupRoleMember}}}
			service := NewService(repo, &fakeAuthenticator{userID: sender}, authorizer, 16*1024)
			if _, err := service.SendSignal(context.Background(), "sender-token", call.ID, target, SignalTypeOffer, []byte("fixture")); err != nil {
				t.Fatal(err)
			}
			switch change {
			case "removed":
				delete(authorizer.participantAccess, target)
			case "reader":
				authorizer.participantAccess[target].GroupRole = GroupRoleReader
			case "unknown_role":
				authorizer.participantAccess[target].GroupRole = ""
			case "wrong_scope":
				authorizer.participantAccess[target].Scope.GroupID = "77777777-7777-7777-7777-777777777777"
			case "unavailable":
				authorizer.participantError = errors.New("chat unavailable")
			}
			envelope, err := service.SendSignal(context.Background(), "sender-token", call.ID, target, SignalTypeICECandidate, []byte("fixture"))
			if change == "eligible" {
				if err != nil || envelope == nil || envelope.TargetUserID != target {
					t.Fatal("eligible recipient must receive signal")
				}
				return
			}
			if err == nil || envelope != nil {
				t.Fatal("ineligible or unverified recipient must not receive envelope")
			}
			_, targetErr := repo.GetActiveParticipant(context.Background(), call.ID, target)
			if change == "unavailable" {
				if targetErr != nil {
					t.Fatal("transient authorization outage must preserve target participation")
				}
			} else {
				if !errors.Is(err, ErrPermissionDenied) || !errors.Is(targetErr, ErrNotFound) {
					t.Fatal("recipient eligibility loss must reject and evict target")
				}
			}
			if _, err := repo.GetActiveParticipant(context.Background(), call.ID, sender); err != nil {
				t.Fatal("valid sender must remain active")
			}
		})
	}
}
