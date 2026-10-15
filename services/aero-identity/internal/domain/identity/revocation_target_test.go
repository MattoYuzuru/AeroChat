package identity

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type revocationTargetRepository struct {
	Repository
	calls  int
	userID string
	target string
}

func (r *revocationTargetRepository) RevokeSession(_ context.Context, userID, target string, _ time.Time) (bool, error) {
	r.calls++
	r.userID, r.target = userID, target
	return false, nil
}

func (r *revocationTargetRepository) RevokeDevice(_ context.Context, userID, target string, _ time.Time) (bool, error) {
	r.calls++
	r.userID, r.target = userID, target
	return false, nil
}

func TestRevokeMalformedTargetDoesNotReachRepository(t *testing.T) {
	service := newTestService()
	auth := mustRegister(t, service, "revoke.fixture", "Revoke fixture")
	repo := &revocationTargetRepository{Repository: service.repo}
	service.repo = repo
	for _, kind := range []string{"session", "device"} {
		for _, value := range []string{"", " \t", "private-target-invalid", "00000000-0000-0000-0000-00000000000z", strings.Repeat("x", 4096)} {
			target := SessionTarget{SessionID: &value}
			if kind == "device" {
				target = SessionTarget{DeviceID: &value}
			}
			err := service.RevokeSessionOrDevice(context.Background(), auth.Token, target)
			if !errors.Is(err, ErrInvalidArgument) || repo.calls != 0 {
				t.Fatalf("%s malformed target must fail before revoke storage: %v, calls=%d", kind, err, repo.calls)
			}
			if strings.TrimSpace(value) != "" && strings.Contains(err.Error(), strings.TrimSpace(value)) {
				t.Fatal("validation error disclosed target input")
			}
		}
	}
	invalid := "private-target-invalid"
	if err := service.RevokeSessionOrDevice(context.Background(), "invalid-token", SessionTarget{SessionID: &invalid}); !errors.Is(err, ErrUnauthorized) || repo.calls != 0 {
		t.Fatal("authentication must precede target validation")
	}
	if err := service.RevokeSessionOrDevice(context.Background(), auth.Token, SessionTarget{}); !errors.Is(err, ErrInvalidArgument) || repo.calls != 0 {
		t.Fatal("missing target must preserve invalid argument contract")
	}
}

func TestRevokeTargetPreservesUUIDCompatibilityAndOwnerScope(t *testing.T) {
	service := newTestService()
	auth := mustRegister(t, service, "revoke.compat", "Revoke compatibility")
	repo := &revocationTargetRepository{Repository: service.repo}
	service.repo = repo
	const canonical = "a0b1c2d3-e4f5-4678-9123-456789abcdef"
	for _, value := range []string{canonical, " \t" + strings.ToUpper(canonical) + "\n", "urn:uuid:" + canonical, "{" + canonical + "}", strings.ReplaceAll(canonical, "-", "")} {
		for _, kind := range []string{"session", "device"} {
			target := SessionTarget{SessionID: &value}
			if kind == "device" {
				target = SessionTarget{DeviceID: &value}
			}
			before := repo.calls
			if err := service.RevokeSessionOrDevice(context.Background(), auth.Token, target); !errors.Is(err, ErrNotFound) || repo.calls != before+1 || repo.userID != auth.User.ID || repo.target != canonical {
				t.Fatalf("valid UUID must retain owner-bound not-found semantics: %v", err)
			}
		}
	}
}
