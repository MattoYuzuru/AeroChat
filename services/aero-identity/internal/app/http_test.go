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
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
)

func TestNewHTTPHandlerServesDiagnosticsAndConnectRoutes(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := NewHTTPHandler(
		logger,
		identityServiceMeta(),
		func(context.Context) error { return nil },
		&testIdentityHandler{},
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

	readinessResponse, err := server.Client().Get(server.URL + "/readyz")
	if err != nil {
		t.Fatalf("запрос к readyz: %v", err)
	}
	defer func() { _ = readinessResponse.Body.Close() }()

	if readinessResponse.StatusCode != http.StatusOK {
		t.Fatalf("ожидался статус %d для /readyz, получен %d", http.StatusOK, readinessResponse.StatusCode)
	}

	client := identityv1connect.NewIdentityServiceClient(server.Client(), server.URL)
	pingResponse, err := client.Ping(context.Background(), connect.NewRequest(&identityv1.PingRequest{}))
	if err != nil {
		t.Fatalf("connect ping: %v", err)
	}

	if pingResponse.Msg.GetService().GetName() != "aero-identity" {
		t.Fatalf("ожидалось имя сервиса aero-identity, получено %q", pingResponse.Msg.GetService().GetName())
	}
}

func TestNewHTTPHandlerReportsReadinessFailures(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	handler := NewHTTPHandler(
		logger,
		identityServiceMeta(),
		func(context.Context) error { return errors.New("postgres unavailable") },
		&testIdentityHandler{},
	)

	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("ожидался статус %d, получен %d", http.StatusServiceUnavailable, recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "postgres unavailable") {
		t.Fatalf("ожидалась причина not ready в ответе, получено %q", recorder.Body.String())
	}
}

func identityServiceMeta() observability.ServiceMeta {
	return observability.ServiceMeta{
		Name:    "aero-identity",
		Version: "dev",
	}
}

type testIdentityHandler struct {
	identityv1connect.UnimplementedIdentityServiceHandler
}

func (h *testIdentityHandler) Ping(context.Context, *connect.Request[identityv1.PingRequest]) (*connect.Response[identityv1.PingResponse], error) {
	return connect.NewResponse(&identityv1.PingResponse{
		Service: &commonv1.ServiceMeta{
			Name:    "aero-identity",
			Version: "dev",
		},
	}), nil
}
