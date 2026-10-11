package identity

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	identityauth "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/auth"
)

type blockedPasswordHasher struct {
	entered chan struct{}
	release chan struct{}
	active  atomic.Int64
	peak    atomic.Int64
}

func (h *blockedPasswordHasher) Hash(string) (string, error) {
	active := h.active.Add(1)
	for old := h.peak.Load(); active > old; old = h.peak.Load() {
		if h.peak.CompareAndSwap(old, active) {
			break
		}
	}
	h.entered <- struct{}{}
	select {
	case <-h.release:
	case <-time.After(3 * time.Second):
		h.active.Add(-1)
		return "", errors.New("bounded fixture timeout")
	}
	h.active.Add(-1)
	return "fixture-hash", nil
}

func (h *blockedPasswordHasher) Verify(string, string) (bool, error) { return false, nil }

func TestPasswordAdmissionKeepsSlotUntilCanceledHashReturns(t *testing.T) {
	service := newTestService()
	hasher := &blockedPasswordHasher{entered: make(chan struct{}, 2), release: make(chan struct{})}
	var releaseOnce sync.Once
	releaseHash := func() { releaseOnce.Do(func() { close(hasher.release) }) }
	t.Cleanup(releaseHash)
	service.passwords = hasher
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	results := make(chan error, 2)
	for _, login := range []string{"admission.alice", "admission.bob"} {
		go func() { _, err := service.hashPassword(ctx, login, "synthetic-password"); results <- err }()
	}
	deadline := time.After(3 * time.Second)
	for range 2 {
		select {
		case <-hasher.entered:
		case <-deadline:
			t.Fatal("bounded workers did not enter hashing")
		}
	}
	cancel()
	if _, err := service.hashPassword(context.Background(), "admission.carol", "synthetic-password"); !errors.Is(err, ErrResourceExhausted) {
		t.Fatalf("canceled in-flight hashes must retain slots: %v", err)
	}
	releaseHash()
	for range 2 {
		if err := <-results; !errors.Is(err, context.Canceled) {
			t.Fatalf("expected cancellation after hash returns: %v", err)
		}
	}
	if hasher.peak.Load() != 2 || hasher.active.Load() != 0 {
		t.Fatalf("hash workers peak=%d active=%d", hasher.peak.Load(), hasher.active.Load())
	}
	if _, err := service.hashPassword(context.Background(), "admission.carol", "synthetic-password"); err != nil {
		t.Fatalf("slots release after work returns: %v", err)
	}
}

func TestPasswordAdmissionBlocksSameLoginButAllowsAnother(t *testing.T) {
	gate, err := NewPasswordAdmission(2)
	if err != nil {
		t.Fatal(err)
	}
	a, err := gate.acquire(context.Background(), "alice")
	if err != nil {
		t.Fatal(err)
	}
	defer a()
	if _, err := gate.acquire(context.Background(), "alice"); !errors.Is(err, ErrResourceExhausted) {
		t.Fatalf("same-login concurrency: %v", err)
	}
	b, err := gate.acquire(context.Background(), "bob")
	if err != nil {
		t.Fatalf("another login must retain capacity: %v", err)
	}
	b()
	b()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := gate.acquire(ctx, "carol"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled admission: %v", err)
	}
}

type failingPasswordHasher struct{}

func (failingPasswordHasher) Hash(string) (string, error) {
	return "", errors.New("fixture hash failure")
}
func (failingPasswordHasher) Verify(string, string) (bool, error) {
	return false, errors.New("fixture verify failure")
}

func TestPasswordAdmissionReleasesAfterHashFailure(t *testing.T) {
	service := newTestService()
	service.passwords = failingPasswordHasher{}
	for range 2 {
		if _, err := service.hashPassword(context.Background(), "alice", "synthetic-password"); err == nil || errors.Is(err, ErrResourceExhausted) {
			t.Fatalf("slot must be reusable after hasher error: %v", err)
		}
	}
}

type rejectingPasswordHasher struct {
	mu      sync.Mutex
	encoded []string
	accept  bool
}

func (*rejectingPasswordHasher) Hash(string) (string, error) { return "fixture-hash", nil }
func (h *rejectingPasswordHasher) Verify(_ string, encoded string) (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.encoded = append(h.encoded, encoded)
	return h.accept, nil
}

func TestMissingLoginAndWrongPasswordUseSameErrorAndVerification(t *testing.T) {
	service := newTestService()
	mustRegister(t, service, "admission.known", "Known")
	hasher := &rejectingPasswordHasher{}
	service.passwords = hasher
	for _, login := range []string{"admission.missing", "admission.known"} {
		if _, err := service.Login(context.Background(), LoginInput{Login: login, Password: "synthetic-password"}); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("missing/wrong credential error: %v", err)
		}
	}
	if len(hasher.encoded) != 2 || hasher.encoded[0] != publicDummyPasswordHash || hasher.encoded[1] == publicDummyPasswordHash {
		t.Fatal("both paths must verify, missing account uses public dummy hash")
	}
}

func TestMissingLoginNeverAuthorizesDummyVerificationSuccess(t *testing.T) {
	service := newTestService()
	service.passwords = &rejectingPasswordHasher{accept: true}
	if _, err := service.Login(context.Background(), LoginInput{Login: "admission.missing", Password: "synthetic-password"}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("dummy success must not authenticate missing account: %v", err)
	}
}

func TestPublicDummyRecordUsesCurrentPasswordWorkFactor(t *testing.T) {
	parts := strings.Split(publicDummyPasswordHash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" || parts[3] != "m=65536,t=3,p=2" {
		t.Fatal("dummy record must retain production Argon parameters")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) != 16 {
		t.Fatal("dummy salt must have production length")
	}
	digest, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(digest) != 32 {
		t.Fatal("dummy digest must have production length")
	}
	if _, err := identityauth.NewPasswordHasher().Verify("public-synthetic-input", publicDummyPasswordHash); err != nil {
		t.Fatalf("real bounded dummy verification: %v", err)
	}
}
