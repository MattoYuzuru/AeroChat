package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	"github.com/google/uuid"
)

func TestPostgresRecipientEligibilityLossReleasesParticipation(t *testing.T) {
	for _, role := range []string{rtc.GroupRoleReader, ""} {
		t.Run("new_role_"+role, func(t *testing.T) {
			db := newTestDatabase(t)
			repo := NewRepository(db)
			call, creator := createTestCall(t, repo, db)
			scope := rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: uuid.NewString()}
			ctx := context.Background()
			if _, err := db.Exec(ctx, "UPDATE rtc_calls SET scope_type='group', direct_chat_id=NULL, group_id=$1 WHERE id=$2", scope.GroupID, call.ID); err != nil {
				t.Fatal(err)
			}
			target := newTestParticipant(t, db, call.ID)
			authorizer := &recipientAuthorizer{scope: scope, targetRole: rtc.GroupRoleMember}
			service := rtc.NewService(repo, recipientAuthenticator{sender: creator.UserID, target: target.UserID}, authorizer, 1024)
			if _, _, err := service.JoinCall(ctx, "target", call.ID); err != nil {
				t.Fatal(err)
			}
			if envelope, err := service.SendSignal(ctx, "sender", call.ID, target.UserID, rtc.SignalTypeOffer, []byte("fixture")); err != nil || envelope == nil {
				t.Fatal("eligible recipient signal rejected")
			}
			authorizer.targetRole = role
			if envelope, err := service.SendSignal(ctx, "sender", call.ID, target.UserID, rtc.SignalTypeICECandidate, []byte("fixture")); !errors.Is(err, rtc.ErrPermissionDenied) || envelope != nil {
				t.Fatal("revoked recipient must not receive envelope")
			}
			if _, err := repo.GetActiveParticipationByUserID(ctx, target.UserID); !errors.Is(err, rtc.ErrNotFound) {
				t.Fatal("revoked recipient retained active user slot")
			}
			if _, err := repo.GetActiveParticipant(ctx, call.ID, creator.UserID); err != nil {
				t.Fatal("sender should remain active")
			}
			assertNextCall(t, repo, target.UserID)
		})
	}
}

type recipientAuthenticator struct{ sender, target string }

func (a recipientAuthenticator) Authenticate(_ context.Context, token string) (*rtc.AuthenticatedUser, error) {
	if token == "target" {
		return &rtc.AuthenticatedUser{ID: a.target}, nil
	}
	return &rtc.AuthenticatedUser{ID: a.sender}, nil
}

type recipientAuthorizer struct {
	scope      rtc.ConversationScope
	targetRole string
}

func (a *recipientAuthorizer) GetScopeAccess(_ context.Context, token string, _ rtc.ConversationScope) (*rtc.ScopeAccess, error) {
	role := rtc.GroupRoleMember
	if token == "target" {
		role = a.targetRole
		if role == "" {
			return nil, rtc.ErrPermissionDenied
		}
	}
	return &rtc.ScopeAccess{Scope: a.scope, GroupRole: role}, nil
}
func (a *recipientAuthorizer) GetParticipantAccess(context.Context, string, rtc.ConversationScope, string) (*rtc.ScopeAccess, error) {
	if a.targetRole == "" {
		return nil, rtc.ErrPermissionDenied
	}
	return &rtc.ScopeAccess{Scope: a.scope, GroupRole: a.targetRole}, nil
}
