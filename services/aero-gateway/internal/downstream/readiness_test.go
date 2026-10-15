package downstream

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestReadinessUsesReadyEndpointAndRecoversFromDependencyFailure(t *testing.T) {
	var status atomic.Int32
	status.Store(http.StatusOK)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/readyz" || r.Method != http.MethodGet {
			t.Errorf("readiness must query diagnostic readyz: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("readiness must not forward user credentials")
		}
		w.WriteHeader(int(status.Load()))
		_, _ = w.Write([]byte("fixture-sensitive-error-body"))
	}))
	defer server.Close()
	clients := NewClients(server.Client(), server.URL, server.URL, server.URL)
	for _, code := range []int{http.StatusOK, http.StatusServiceUnavailable, http.StatusOK} {
		status.Store(int32(code))
		err := clients.ReadinessCheck(context.Background())
		if (err == nil) != (code == http.StatusOK) {
			t.Fatalf("code=%d: unexpected readiness: %v", code, err)
		}
		if err != nil && (strings.Contains(err.Error(), server.URL) || strings.Contains(err.Error(), "sensitive")) {
			t.Fatal("readiness exposed upstream response or endpoint")
		}
	}
}

func TestReadinessHonorsCallerDeadline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer server.Close()
	clients := NewClients(server.Client(), server.URL, server.URL, server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	started := time.Now()
	if clients.ReadinessCheck(ctx) == nil {
		t.Fatal("timed out downstream must not be ready")
	}
	if time.Since(started) > time.Second {
		t.Fatal("downstream readiness exceeded caller deadline")
	}
}
