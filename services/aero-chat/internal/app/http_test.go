package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
)

func TestNewHTTPHandlerServesDiagnosticsAndConnectRoutes(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := NewHTTPHandler(
		logger,
		chatServiceMeta(),
		func(context.Context) error { return nil },
		&testChatHandler{},
	)

	server := httptest.NewServer(handler)
	defer server.Close()

	rootResponse, err := server.Client().Get(server.URL + "/")
	if err != nil {
		t.Fatalf("запрос к корню сервиса: %v", err)
	}
	defer func() { _ = rootResponse.Body.Close() }()

	if rootResponse.StatusCode != http.StatusOK {
		t.Fatalf("ожидался статус %d для /, получен %d", http.StatusOK, rootResponse.StatusCode)
	}

	healthResponse, err := server.Client().Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("запрос к healthz: %v", err)
	}
	defer func() { _ = healthResponse.Body.Close() }()

	if healthResponse.StatusCode != http.StatusOK {
		t.Fatalf("ожидался статус %d для /healthz, получен %d", http.StatusOK, healthResponse.StatusCode)
	}

	client := chatv1connect.NewChatServiceClient(server.Client(), server.URL)
	pingResponse, err := client.Ping(context.Background(), connect.NewRequest(&chatv1.PingRequest{}))
	if err != nil {
		t.Fatalf("connect ping: %v", err)
	}

	if pingResponse.Msg.GetService().GetName() != "aero-chat" {
		t.Fatalf("ожидалось имя сервиса aero-chat, получено %q", pingResponse.Msg.GetService().GetName())
	}
}

func TestNewHTTPHandlerReportsReadinessFailures(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := NewHTTPHandler(
		logger,
		chatServiceMeta(),
		func(context.Context) error { return errors.New("redis unavailable") },
		&testChatHandler{},
	)

	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("ожидался статус %d, получен %d", http.StatusServiceUnavailable, recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "redis unavailable") {
		t.Fatalf("ожидалась причина not ready в ответе, получено %q", recorder.Body.String())
	}
}

func chatServiceMeta() observability.ServiceMeta {
	return observability.ServiceMeta{
		Name:    "aero-chat",
		Version: "dev",
	}
}

type testChatHandler struct {
	chatv1connect.UnimplementedChatServiceHandler
}

func (h *testChatHandler) Ping(context.Context, *connect.Request[chatv1.PingRequest]) (*connect.Response[chatv1.PingResponse], error) {
	return connect.NewResponse(&chatv1.PingResponse{
		Service: &commonv1.ServiceMeta{
			Name:    "aero-chat",
			Version: "dev",
		},
	}), nil
}
