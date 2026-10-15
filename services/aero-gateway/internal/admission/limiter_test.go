package admission

import (
	"context"
	"errors"
	"net/http"
	"net/netip"
	"testing"
	"time"

	"connectrpc.com/connect"
)

func mustAcquire(t *testing.T, limiter *Limiter, operation Operation, peer, login string) func() {
	t.Helper()
	release, err := limiter.Acquire(context.Background(), operation, peer, nil, login)
	if err != nil {
		t.Fatalf("authorized admission: %v", err)
	}
	return release
}

func requireExhausted(t *testing.T, err error, retry string) {
	t.Helper()
	var coded *connect.Error
	if !errors.As(err, &coded) || coded.Code() != connect.CodeResourceExhausted || coded.Meta().Get("Retry-After") != retry {
		t.Fatalf("expected exhausted with Retry-After %s, got %v", retry, err)
	}
}

func TestLimiterPreservesNATCapacityForAnotherLogin(t *testing.T) {
	cfg := DefaultConfig()
	cfg.loginBurst = 2
	limiter := NewLimiter(cfg)
	a := mustAcquire(t, limiter, Login, "127.0.0.1:1001", " Alice ")
	defer a()
	for range 5 {
		_, err := limiter.Acquire(context.Background(), Login, "127.0.0.1:1002", nil, "ALICE")
		requireExhausted(t, err, "1")
	}
	b := mustAcquire(t, limiter, Login, "127.0.0.1:1003", "bob")
	b()
	b()
}

func TestLimiterBurstAndClockRefill(t *testing.T) {
	limiter := NewLimiter(DefaultConfig())
	now := time.Now()
	limiter.now = func() time.Time { return now }
	for range 3 {
		mustAcquire(t, limiter, Register, "127.0.0.1:1001", "alice")()
	}
	_, err := limiter.Acquire(context.Background(), Register, "127.0.0.1:1001", nil, "bob")
	requireExhausted(t, err, "600")
	now = now.Add(9 * time.Minute)
	_, err = limiter.Acquire(context.Background(), Register, "127.0.0.1:1001", nil, "bob")
	requireExhausted(t, err, "60")
	now = now.Add(time.Minute)
	mustAcquire(t, limiter, Register, "127.0.0.1:1001", "bob")()
	mustAcquire(t, limiter, Login, "127.0.0.1:1001", "bob")()
}

func TestRejectedIPCannotAllocateFreshAccountKeys(t *testing.T) {
	cfg := DefaultConfig()
	cfg.loginBurst = 1
	limiter := NewLimiter(cfg)
	now := time.Now()
	limiter.now = func() time.Time { return now }
	mustAcquire(t, limiter, Login, "127.0.0.1:1001", "alice")()
	for _, login := range []string{"bob", "carol", "dave"} {
		_, err := limiter.Acquire(context.Background(), Login, "127.0.0.1:1001", nil, login)
		requireExhausted(t, err, "1")
	}
	if len(limiter.buckets) != 2 {
		t.Fatalf("denied login rotation allocated %d keys", len(limiter.buckets))
	}
}

func TestLimiterFullTableDoesNotEvictFreshOrActiveKeys(t *testing.T) {
	cfg := DefaultConfig()
	cfg.maxKeys = 2
	limiter := NewLimiter(cfg)
	now := time.Now()
	limiter.now = func() time.Time { return now }
	active := mustAcquire(t, limiter, Register, "127.0.0.1:1001", "alice")
	defer active()
	mustAcquire(t, limiter, Register, "127.0.0.2:1001", "bob")()
	_, err := limiter.Acquire(context.Background(), Register, "127.0.0.3:1001", nil, "carol")
	requireExhausted(t, err, "1")
	if len(limiter.buckets) != 2 {
		t.Fatal("fresh keys were evicted")
	}
	now = now.Add(3 * time.Hour)
	mustAcquire(t, limiter, Register, "127.0.0.3:1001", "carol")()
	_, err = limiter.Acquire(context.Background(), Register, "127.0.0.1:1001", nil, "alice")
	requireExhausted(t, err, "1")
	if len(limiter.buckets) != 2 {
		t.Fatal("active key was evicted")
	}
}

func TestLimiterCanceledAdmissionUsesNoCapacity(t *testing.T) {
	limiter := NewLimiter(DefaultConfig())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := limiter.Acquire(ctx, Login, "127.0.0.1:1001", nil, "alice"); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation: %v", err)
	}
	if len(limiter.buckets) != 0 {
		t.Fatal("canceled request allocated buckets")
	}
	release := mustAcquire(t, limiter, Register, "127.0.0.1:1001", "alice")
	release()
	mustAcquire(t, limiter, Register, "127.0.0.1:1001", "bob")()
}

func TestLimiterClientAddressTrustBoundary(t *testing.T) {
	cfg := DefaultConfig()
	cfg.trustedProxies = []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}
	limiter := NewLimiter(cfg)
	for _, tc := range []struct {
		name, peer, want string
		headers          http.Header
		invalid          bool
	}{
		{"trusted", "127.0.0.1:1001", "192.0.2.1", http.Header{"X-Real-Ip": {"192.0.2.1"}}, false},
		{"mapped-peer", "[::ffff:127.0.0.1]:1001", "192.0.2.1", http.Header{"X-Real-Ip": {"192.0.2.1"}}, false},
		{"untrusted-ignores-header", "192.0.2.2:1001", "192.0.2.2", http.Header{"X-Real-Ip": {"broken"}}, false},
		{"untrusted-ignores-xff", "192.0.2.2:1001", "192.0.2.2", http.Header{"X-Forwarded-For": {"192.0.2.1"}}, false},
		{"trusted-missing", "127.0.0.1:1001", "", nil, true},
		{"trusted-duplicate", "127.0.0.1:1001", "", http.Header{"X-Real-Ip": {"192.0.2.1", "192.0.2.2"}}, true},
		{"trusted-chain", "127.0.0.1:1001", "", http.Header{"X-Real-Ip": {"192.0.2.1,192.0.2.2"}}, true},
		{"trusted-invalid", "127.0.0.1:1001", "", http.Header{"X-Real-Ip": {"broken"}}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			address, err := limiter.clientAddress(tc.peer, tc.headers)
			if tc.invalid {
				if err == nil {
					t.Fatal("expected invalid trusted header")
				}
				return
			}
			if err != nil || address.String() != tc.want {
				t.Fatalf("address=%s error=%v", address, err)
			}
		})
	}
}
