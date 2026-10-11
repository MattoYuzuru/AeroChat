package mediacontract

import (
	"errors"
	"math"
	"testing"
)

func TestDelayedChatDenyDoesNotRevokeNewEligibleEpoch(t *testing.T) {
	model, token, authority, now := fixture(t)
	newBinding := model.binding
	newBinding.EligibilityEpoch = 3
	newBinding.Key.Generation++
	token.Key = newBinding.Key
	newGrant, err := NewReferenceModel(newBinding)
	if err != nil {
		t.Fatal(err)
	}
	if err := newGrant.Activate(); err != nil {
		t.Fatal(err)
	}
	if err := newGrant.ApplyChatRevocation(ChatRevocation{GroupID: "group", UserID: "user", EligibilityEpoch: 2}); err != nil {
		t.Fatal(err)
	}
	if newGrant.State() != Active {
		t.Fatal("late denied epoch2 revoked new eligible epoch3")
	}
	authority.EligibilityEpoch = 3
	for _, role := range []string{"owner", "admin", "member"} {
		authority.GroupRole = role
		if err := newGrant.CheckAdmission(token, authority, now); err != nil {
			t.Fatal("fresh eligible role/epoch denied")
		}
	}
	authority.EligibilityEpoch = 2
	if err := newGrant.CheckAdmission(token, authority, now); !errors.Is(err, ErrDenied) {
		t.Fatal("stale epoch accepted")
	}
	if err := model.Activate(); err != nil {
		t.Fatal(err)
	}
	if err := model.ApplyChatRevocation(ChatRevocation{GroupID: "group", UserID: "user", EligibilityEpoch: 2}); err != nil {
		t.Fatal(err)
	}
	if model.State() != Revoking {
		t.Fatal("old grant epoch1 did not enter pending teardown")
	}
	if err := model.ConfirmTeardown(TeardownAcknowledgement{Key: model.binding.Key}); !errors.Is(err, ErrTeardownPending) {
		t.Fatal("source event was treated as media completion")
	}
}

func TestChatEpochMalformedBindingAndEventDeny(t *testing.T) {
	model, _, _, _ := fixture(t)
	for _, epoch := range []int64{-1, 0, math.MaxInt64} {
		binding := model.binding
		binding.EligibilityEpoch = epoch
		if _, err := NewReferenceModel(binding); !errors.Is(err, ErrDenied) {
			t.Fatal("unsupported grant epoch accepted")
		}
	}
	for _, event := range []ChatRevocation{{GroupID: "foreign", UserID: "user", EligibilityEpoch: 2}, {GroupID: "group", UserID: "foreign", EligibilityEpoch: 2}, {GroupID: "group", UserID: "user", EligibilityEpoch: 0}} {
		if err := model.ApplyChatRevocation(event); !errors.Is(err, ErrDenied) {
			t.Fatal("invalid source event accepted")
		}
		if model.State() != Prepared {
			t.Fatal("invalid event mutated grant")
		}
	}
}
