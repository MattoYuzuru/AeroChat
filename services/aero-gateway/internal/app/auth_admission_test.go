package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/downstream"
)

type admissionIdentityFixture struct {
	identityv1connect.UnimplementedIdentityServiceHandler
	entered       chan string
	release       chan struct{}
	registerCalls atomic.Int64
}

func (f *admissionIdentityFixture) Register(context.Context, *connect.Request[identityv1.RegisterRequest]) (*connect.Response[identityv1.RegisterResponse], error) {
	f.registerCalls.Add(1)
	return connect.NewResponse(&identityv1.RegisterResponse{Auth: &identityv1.CurrentAuth{}}), nil
}

func (f *admissionIdentityFixture) Login(ctx context.Context, req *connect.Request[identityv1.LoginRequest]) (*connect.Response[identityv1.LoginResponse], error) {
	select {
	case f.entered <- req.Msg.Login:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	select {
	case <-f.release:
		return connect.NewResponse(&identityv1.LoginResponse{Auth: &identityv1.CurrentAuth{}}), nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func admissionGatewayFixture(t *testing.T, fixture *admissionIdentityFixture) *httptest.Server {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityServer := httptest.NewServer(identityHTTPHandler(fixture))
	t.Cleanup(identityServer.Close)
	clients := downstream.NewClients(&http.Client{Timeout: time.Second}, identityServer.URL, identityServer.URL, identityServer.URL)
	server := httptest.NewServer(NewHTTPHandler(logger, observability.ServiceMeta{Name: "gateway-admission-fixture"}, Config{CORSAllowedOrigins: []string{"http://app.aerochat.local"}}, clients, nil))
	t.Cleanup(server.Close)
	return server
}

func TestAuthAdmissionReturnsHTTP429RetryAfterAndCORS(t *testing.T) {
	fixture := &admissionIdentityFixture{}
	server := admissionGatewayFixture(t, fixture)
	for attempt := 0; attempt < 4; attempt++ {
		req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, server.URL+identityv1connect.IdentityServiceRegisterProcedure, strings.NewReader(`{"login":"alice","nickname":"Alice","password":"synthetic-password"}`))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Connect-Protocol-Version", "1")
		req.Header.Set("Origin", "http://app.aerochat.local")
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var body struct {
			Code string `json:"code"`
		}
		err = json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		if attempt < 3 {
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("ordinary register status=%d", resp.StatusCode)
			}
			continue
		}
		if resp.StatusCode != http.StatusTooManyRequests || body.Code != "resource_exhausted" || resp.Header.Get("Retry-After") != "600" {
			t.Fatalf("rate refusal status=%d code=%s retry=%s", resp.StatusCode, body.Code, resp.Header.Get("Retry-After"))
		}
		if resp.Header.Get("Access-Control-Expose-Headers") != "Retry-After" {
			t.Fatal("cross-origin client must see retry delay")
		}
	}
	if fixture.registerCalls.Load() != 3 {
		t.Fatalf("refused request reached downstream: %d", fixture.registerCalls.Load())
	}
}

func TestAuthAdmissionConcurrentNATAllowsDifferentLogin(t *testing.T) {
	fixture := &admissionIdentityFixture{entered: make(chan string, 2), release: make(chan struct{})}
	server := admissionGatewayFixture(t, fixture)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	client := identityv1connect.NewIdentityServiceClient(server.Client(), server.URL)
	results := make(chan error, 2)
	login := func(name string) {
		_, err := client.Login(ctx, connect.NewRequest(&identityv1.LoginRequest{Login: name, Password: "synthetic-password"}))
		results <- err
	}
	go login("alice")
	select {
	case <-fixture.entered:
	case <-ctx.Done():
		t.Fatal("first bounded worker did not enter")
	}
	_, err := client.Login(ctx, connect.NewRequest(&identityv1.LoginRequest{Login: " ALICE ", Password: "synthetic-password"}))
	var coded *connect.Error
	if !errors.As(err, &coded) || coded.Code() != connect.CodeResourceExhausted || coded.Meta().Get("Retry-After") != "1" {
		t.Fatalf("same-login refusal: %v", err)
	}
	go login("bob")
	select {
	case name := <-fixture.entered:
		if name != "bob" {
			t.Fatalf("second worker name=%s", name)
		}
	case <-ctx.Done():
		t.Fatal("another NAT login must retain capacity")
	}
	close(fixture.release)
	for range 2 {
		if err := <-results; err != nil {
			t.Fatalf("ordinary concurrent login: %v", err)
		}
	}
}

func TestAuthAdmissionRejectsOversizedAuthMessageBeforeDownstream(t *testing.T) {
	fixture := &admissionIdentityFixture{}
	server := admissionGatewayFixture(t, fixture)
	client := identityv1connect.NewIdentityServiceClient(server.Client(), server.URL)
	_, err := client.Register(context.Background(), connect.NewRequest(&identityv1.RegisterRequest{Login: "alice", Nickname: strings.Repeat("x", 5000), Password: "synthetic-password"}))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("oversized auth message: %v", err)
	}
	if fixture.registerCalls.Load() != 0 {
		t.Fatal("oversized request reached downstream")
	}
}
