package downstream

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
)

func TestParticipantAccessUsesFreshTypedRosterAndSenderBearer(t *testing.T) {
	for _, kind := range []string{rtc.ScopeTypeGroup, rtc.ScopeTypeDirect} {
		t.Run(kind, func(t *testing.T) {
			handler := &rosterHandler{t: t}
			handler.targetPresent.Store(true)
			path, h := chatv1connect.NewChatServiceHandler(handler)
			mux := http.NewServeMux()
			mux.Handle(path, h)
			server := httptest.NewServer(mux)
			defer server.Close()
			authorizer := NewChatScopeAuthorizer(chatv1connect.NewChatServiceClient(server.Client(), server.URL))
			scope := rtc.ConversationScope{Type: kind, GroupID: "group-1", DirectChatID: "direct-1"}
			access, err := authorizer.GetParticipantAccess(context.Background(), "sender-token", scope, "target")
			if err != nil || access == nil || access.Scope != scope {
				t.Fatal("expected target roster access")
			}
			handler.targetPresent.Store(false)
			if _, err := authorizer.GetParticipantAccess(context.Background(), "sender-token", scope, "target"); !errors.Is(err, rtc.ErrPermissionDenied) {
				t.Fatal("fresh roster removal must reject target")
			}
			if handler.calls.Load() != 2 {
				t.Fatal("target eligibility must fetch roster for each operation")
			}
		})
	}
}

type rosterHandler struct {
	chatv1connect.UnimplementedChatServiceHandler
	t             *testing.T
	targetPresent atomic.Bool
	calls         atomic.Int32
}

func (h *rosterHandler) ListGroupMembers(_ context.Context, request *connect.Request[chatv1.ListGroupMembersRequest]) (*connect.Response[chatv1.ListGroupMembersResponse], error) {
	h.t.Helper()
	h.calls.Add(1)
	if request.Header().Get("Authorization") != "Bearer sender-token" || request.Msg.GroupId != "group-1" {
		h.t.Error("wrong sender authorization or group scope")
	}
	response := &chatv1.ListGroupMembersResponse{}
	if h.targetPresent.Load() {
		response.Members = []*chatv1.GroupMember{{User: &chatv1.ChatUser{Id: "target"}, Role: chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_MEMBER}}
	}
	return connect.NewResponse(response), nil
}

func (h *rosterHandler) GetDirectChat(_ context.Context, request *connect.Request[chatv1.GetDirectChatRequest]) (*connect.Response[chatv1.GetDirectChatResponse], error) {
	h.t.Helper()
	h.calls.Add(1)
	if request.Header().Get("Authorization") != "Bearer sender-token" || request.Msg.ChatId != "direct-1" {
		h.t.Error("wrong sender authorization or direct scope")
	}
	response := &chatv1.GetDirectChatResponse{Chat: &chatv1.DirectChat{Id: "direct-1"}}
	if h.targetPresent.Load() {
		response.Chat.Participants = []*chatv1.ChatUser{{Id: "target"}}
	}
	return connect.NewResponse(response), nil
}
