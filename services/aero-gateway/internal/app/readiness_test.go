package app

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
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/downstream"
)

func TestGatewayPropagatesFullReadinessWhilePingAndHealthRemainAvailable(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identity := httptest.NewServer(identityHTTPHandler(&testIdentityHandler{}))
	defer identity.Close()
	rtc := httptest.NewServer(rtcHTTPHandler(&testRTCHandler{}))
	defer rtc.Close()
	var storageUnavailable atomic.Bool
	chatRPC := chatHTTPHandler(&testChatHandler{})
	chat := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/readyz" && storageUnavailable.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		chatRPC.ServeHTTP(w, r)
	}))
	defer chat.Close()
	clients := downstream.NewClients(&http.Client{Timeout: time.Second}, identity.URL, chat.URL, rtc.URL)
	handler := NewHTTPHandler(logger, observability.ServiceMeta{Name: "aero-gateway"}, Config{}, clients, newTestRealtimeHub(t, logger))
	for _, unavailable := range []bool{false, true, false} {
		storageUnavailable.Store(unavailable)
		if _, err := clients.Chat.Ping(context.Background(), connect.NewRequest(&chatv1.PingRequest{})); err != nil {
			t.Fatalf("RPC Ping contract changed: %v", err)
		}
		ready := httptest.NewRecorder()
		handler.ServeHTTP(ready, httptest.NewRequest(http.MethodGet, "/readyz", nil))
		expected := http.StatusOK
		if unavailable {
			expected = http.StatusServiceUnavailable
		}
		if ready.Code != expected {
			t.Fatalf("storage unavailable=%v: readiness=%d", unavailable, ready.Code)
		}
		health := httptest.NewRecorder()
		handler.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/healthz", nil))
		if health.Code != http.StatusOK {
			t.Fatalf("dependency failure blocked process health: %d", health.Code)
		}
	}
}
