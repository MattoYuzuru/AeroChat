package realtime

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestHandlerPublishesEventsToAuthenticatedUser(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger, time.Minute, time.Second)
	defer hub.Close()

	handler := NewHandler(logger, fakeAuthenticator{
		principal: Principal{UserID: "user-1", Login: "alice", Nickname: "Alice"},
	}, hub, []string{"http://app.aerochat.local"})

	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, websocketURLForTest(server.URL+Path), &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Origin": []string{"http://app.aerochat.local"},
		},
		Subprotocols: []string{Protocol, "aerochat.auth.v1.session.secret"},
	})
	if err != nil {
		t.Fatalf("dial realtime websocket: %v", err)
	}
	defer conn.CloseNow()

	var ready Envelope
	if err := wsjson.Read(ctx, conn, &ready); err != nil {
		t.Fatalf("read ready event: %v", err)
	}
	if ready.Type != EventTypeReady {
		t.Fatalf("ожидался тип события %q, получен %q", EventTypeReady, ready.Type)
	}

	delivered := hub.PublishToUser("user-1", newEnvelope("people.updated", map[string]string{
		"kind": "bootstrap",
	}))
	if delivered != 1 {
		t.Fatalf("ожидалась доставка в 1 websocket-сессию, получено %d", delivered)
	}

	var update struct {
		Type    string            `json:"type"`
		Payload map[string]string `json:"payload"`
	}
	if err := wsjson.Read(ctx, conn, &update); err != nil {
		t.Fatalf("read published event: %v", err)
	}
	if update.Type != "people.updated" {
		t.Fatalf("ожидался тип %q, получен %q", "people.updated", update.Type)
	}
	if update.Payload["kind"] != "bootstrap" {
		t.Fatalf("ожидался payload kind %q, получен %q", "bootstrap", update.Payload["kind"])
	}
}

func TestHandlerClosesConnectionsOnHubShutdown(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger, time.Minute, time.Second)

	handler := NewHandler(logger, fakeAuthenticator{
		principal: Principal{UserID: "user-1", Login: "alice", Nickname: "Alice"},
	}, hub, []string{"http://app.aerochat.local"})

	server := httptest.NewServer(handler)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, websocketURLForTest(server.URL+Path), &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Origin": []string{"http://app.aerochat.local"},
		},
		Subprotocols: []string{Protocol, "aerochat.auth.v1.session.secret"},
	})
	if err != nil {
		t.Fatalf("dial realtime websocket: %v", err)
	}
	defer conn.CloseNow()

	var ready Envelope
	if err := wsjson.Read(ctx, conn, &ready); err != nil {
		t.Fatalf("read ready event: %v", err)
	}

	hub.Close()

	_, _, err = conn.Read(ctx)
	if websocket.CloseStatus(err) != websocket.StatusGoingAway {
		t.Fatalf("ожидался close status %d, получен %d (err=%v)", websocket.StatusGoingAway, websocket.CloseStatus(err), err)
	}
}

type fakeAuthenticator struct {
	principal Principal
	err       error
}

func (a fakeAuthenticator) Authenticate(context.Context, string) (Principal, error) {
	if a.err != nil {
		return Principal{}, a.err
	}

	return a.principal, nil
}

func websocketURLForTest(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return value
	}

	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	default:
		parsed.Scheme = "ws"
	}

	return parsed.String()
}
