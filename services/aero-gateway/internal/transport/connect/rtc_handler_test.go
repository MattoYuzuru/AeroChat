package connecthandler

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	rtcv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1"
	rtcv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/realtime"
)

func TestRTCHandlerStartCallResolvesRecipientsOnlyOnce(t *testing.T) {
	t.Helper()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	rtcDownstream := &testRTCDownstream{}
	chatDownstream := &countingChatDownstream{}

	rtcServer := httptest.NewServer(newRTCDownstreamHTTPHandler(rtcDownstream))
	t.Cleanup(rtcServer.Close)
	chatServer := httptest.NewServer(newChatDownstreamHTTPHandler(chatDownstream))
	t.Cleanup(chatServer.Close)

	realtimeHub := realtime.NewHub(logger, time.Minute, time.Second, nil)
	t.Cleanup(realtimeHub.Close)

	handler := NewRTCHandler(
		logger,
		"aero-gateway",
		"test",
		rtcv1connect.NewRtcControlServiceClient(&http.Client{Timeout: time.Second}, rtcServer.URL),
		chatv1connect.NewChatServiceClient(&http.Client{Timeout: time.Second}, chatServer.URL),
		realtimeHub,
	)

	request := connect.NewRequest(&rtcv1.StartCallRequest{
		Scope: &rtcv1.ConversationScope{
			Type:         rtcv1.ConversationScopeType_CONVERSATION_SCOPE_TYPE_DIRECT,
			DirectChatId: "11111111-1111-1111-1111-111111111111",
		},
	})
	request.Header().Set("Authorization", "Bearer token-1")

	if _, err := handler.StartCall(context.Background(), request); err != nil {
		t.Fatalf("start call: %v", err)
	}

	if got := chatDownstream.getDirectChatCalls.Load(); got != 1 {
		t.Fatalf("ожидался один downstream GetDirectChat lookup, получено %d", got)
	}
}

type testRTCDownstream struct {
	rtcv1connect.UnimplementedRtcControlServiceHandler
}

func (h *testRTCDownstream) StartCall(
	context.Context,
	*connect.Request[rtcv1.StartCallRequest],
) (*connect.Response[rtcv1.StartCallResponse], error) {
	return connect.NewResponse(&rtcv1.StartCallResponse{
		Call: &rtcv1.Call{
			Id: "call-1",
			Scope: &rtcv1.ConversationScope{
				Type:         rtcv1.ConversationScopeType_CONVERSATION_SCOPE_TYPE_DIRECT,
				DirectChatId: "11111111-1111-1111-1111-111111111111",
			},
			CreatedByUserId:        "user-1",
			Status:                 rtcv1.CallStatus_CALL_STATUS_ACTIVE,
			ActiveParticipantCount: 1,
		},
		SelfParticipant: &rtcv1.CallParticipant{
			Id:     "participant-1",
			CallId: "call-1",
			UserId: "user-1",
			State:  rtcv1.ParticipantState_PARTICIPANT_STATE_ACTIVE,
		},
	}), nil
}

type countingChatDownstream struct {
	chatv1connect.UnimplementedChatServiceHandler
	getDirectChatCalls atomic.Int32
}

func (h *countingChatDownstream) GetDirectChat(
	context.Context,
	*connect.Request[chatv1.GetDirectChatRequest],
) (*connect.Response[chatv1.GetDirectChatResponse], error) {
	h.getDirectChatCalls.Add(1)

	return connect.NewResponse(&chatv1.GetDirectChatResponse{
		Chat: &chatv1.DirectChat{
			Id: "11111111-1111-1111-1111-111111111111",
			Participants: []*chatv1.ChatUser{
				{Id: "user-1"},
				{Id: "user-2"},
			},
		},
	}), nil
}

func newRTCDownstreamHTTPHandler(handler rtcv1connect.RtcControlServiceHandler) http.Handler {
	_, httpHandler := rtcv1connect.NewRtcControlServiceHandler(handler)
	return httpHandler
}

func newChatDownstreamHTTPHandler(handler chatv1connect.ChatServiceHandler) http.Handler {
	_, httpHandler := chatv1connect.NewChatServiceHandler(handler)
	return httpHandler
}
