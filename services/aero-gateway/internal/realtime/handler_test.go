package realtime

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestHandlerPublishesEventsToAuthenticatedUser(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger, time.Minute, time.Second, nil)
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
	defer func() {
		_ = conn.CloseNow()
	}()

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
	hub := NewHub(logger, time.Minute, time.Second, nil)

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
	defer func() {
		_ = conn.CloseNow()
	}()

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

func TestHandlerBindsRealtimeSessionToActiveCryptoDevice(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger, time.Minute, time.Second, fakeCryptoDeviceAuthorizer{
		devices: map[string]BoundCryptoDevice{
			"crypto-1": {
				ID:     "crypto-1",
				UserID: "user-1",
			},
		},
	})
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
	defer func() {
		_ = conn.CloseNow()
	}()

	var ready Envelope
	if err := wsjson.Read(ctx, conn, &ready); err != nil {
		t.Fatalf("read ready event: %v", err)
	}

	if err := wsjson.Write(ctx, conn, map[string]any{
		"type": ClientEventTypeBindCryptoDevice,
		"payload": map[string]string{
			"cryptoDeviceId": "crypto-1",
		},
	}); err != nil {
		t.Fatalf("write bind event: %v", err)
	}

	var bound struct {
		Type    string `json:"type"`
		Payload struct {
			ConnectionID   string `json:"connectionId"`
			UserID         string `json:"userId"`
			CryptoDeviceID string `json:"cryptoDeviceId"`
		} `json:"payload"`
	}
	if err := wsjson.Read(ctx, conn, &bound); err != nil {
		t.Fatalf("read bound event: %v", err)
	}
	if bound.Type != EventTypeCryptoDeviceBound {
		t.Fatalf("ожидался тип %q, получен %q", EventTypeCryptoDeviceBound, bound.Type)
	}
	if bound.Payload.CryptoDeviceID != "crypto-1" {
		t.Fatalf("ожидался crypto_device_id %q, получен %q", "crypto-1", bound.Payload.CryptoDeviceID)
	}

	delivered := hub.PublishToCryptoDevice("crypto-1", newEnvelope("encrypted.test", map[string]string{
		"kind": "delivery",
	}))
	if delivered != 1 {
		t.Fatalf("ожидалась доставка в 1 crypto-device session, получено %d", delivered)
	}

	var event struct {
		Type    string            `json:"type"`
		Payload map[string]string `json:"payload"`
	}
	if err := wsjson.Read(ctx, conn, &event); err != nil {
		t.Fatalf("read published crypto-device event: %v", err)
	}
	if event.Type != "encrypted.test" {
		t.Fatalf("ожидался тип %q, получен %q", "encrypted.test", event.Type)
	}
}

func TestHandlerRejectsBindingForForeignCryptoDevice(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := NewHub(logger, time.Minute, time.Second, fakeCryptoDeviceAuthorizer{
		devices: map[string]BoundCryptoDevice{
			"crypto-2": {
				ID:     "crypto-2",
				UserID: "user-2",
			},
		},
	})
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
	defer func() {
		_ = conn.CloseNow()
	}()

	var ready Envelope
	if err := wsjson.Read(ctx, conn, &ready); err != nil {
		t.Fatalf("read ready event: %v", err)
	}

	if err := wsjson.Write(ctx, conn, map[string]any{
		"type": ClientEventTypeBindCryptoDevice,
		"payload": map[string]string{
			"cryptoDeviceId": "crypto-2",
		},
	}); err != nil {
		t.Fatalf("write bind event: %v", err)
	}

	var rejected struct {
		Type    string `json:"type"`
		Payload struct {
			Reason         string `json:"reason"`
			CryptoDeviceID string `json:"cryptoDeviceId"`
		} `json:"payload"`
	}
	if err := wsjson.Read(ctx, conn, &rejected); err != nil {
		t.Fatalf("read rejected event: %v", err)
	}
	if rejected.Type != EventTypeCryptoDeviceBindRejected {
		t.Fatalf("ожидался тип %q, получен %q", EventTypeCryptoDeviceBindRejected, rejected.Type)
	}
	if rejected.Payload.Reason != cryptoDeviceBindRejectReasonPermissionDenied {
		t.Fatalf("ожидалась причина %q, получена %q", cryptoDeviceBindRejectReasonPermissionDenied, rejected.Payload.Reason)
	}

	delivered := hub.PublishToCryptoDevice("crypto-2", newEnvelope("encrypted.test", map[string]string{
		"kind": "delivery",
	}))
	if delivered != 0 {
		t.Fatalf("не ожидалась доставка в foreign crypto-device session, получено %d", delivered)
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

type fakeCryptoDeviceAuthorizer struct {
	devices map[string]BoundCryptoDevice
}

func (a fakeCryptoDeviceAuthorizer) AuthorizeActiveDevice(_ context.Context, _ string, userID string, cryptoDeviceID string) (BoundCryptoDevice, error) {
	device, ok := a.devices[cryptoDeviceID]
	if !ok {
		return BoundCryptoDevice{}, connect.NewError(connect.CodeNotFound, errors.New("crypto device not found"))
	}
	if device.UserID != userID {
		return BoundCryptoDevice{}, connect.NewError(connect.CodePermissionDenied, errors.New("foreign crypto device"))
	}

	return device, nil
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
