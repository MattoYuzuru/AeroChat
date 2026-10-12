package mediacontrol

import (
	"errors"
	"math"
	"testing"

	"github.com/google/uuid"
)

func TestFreshControlGroupFactsRejectMalformedEvidence(t *testing.T) {
	group, user := uuid.New(), uuid.New()
	for _, test := range []struct {
		name  string
		facts GroupFacts
	}{
		{"unknown_status", GroupFacts{GroupID: group, UserID: user, Epoch: 1, Status: "unknown", Role: "member"}},
		{"present_missing_user", GroupFacts{GroupID: group, Epoch: 1, Status: "present", Role: "member"}},
		{"present_missing_group", GroupFacts{UserID: user, Epoch: 1, Status: "present", Role: "member"}},
		{"present_zero_epoch", GroupFacts{GroupID: group, UserID: user, Status: "present", Role: "member"}},
		{"present_negative_epoch", GroupFacts{GroupID: group, UserID: user, Epoch: -1, Status: "present", Role: "member"}},
		{"present_unknown_role", GroupFacts{GroupID: group, UserID: user, Epoch: 1, Status: "present", Role: "unknown"}},
		{"eligible_exhausted_epoch", GroupFacts{GroupID: group, UserID: user, Epoch: math.MaxInt64, Status: "present", Role: "owner"}},
		{"not_found_nonempty_tuple", GroupFacts{GroupID: group, UserID: user, Epoch: 1, Status: "not_found"}},
		{"not_found_role", GroupFacts{Status: "not_found", Role: "removed"}},
		{"removed_missing_tuple", GroupFacts{Epoch: 1, Status: "removed"}},
		{"removed_present_role", GroupFacts{GroupID: group, UserID: user, Epoch: 1, Status: "removed", Role: "member"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := test.facts.Validate(); !errors.Is(err, ErrUnavailable) {
				t.Fatal("malformed Chat evidence accepted", err)
			}
		})
	}
	for _, facts := range []GroupFacts{
		{Status: "not_found"},
		{GroupID: group, UserID: user, Epoch: 1, Status: "present", Role: "member"},
		{GroupID: group, UserID: user, Epoch: 1, Status: "removed"},
		{GroupID: group, UserID: user, Epoch: math.MaxInt64, Status: "present", Role: "reader"},
		{GroupID: group, UserID: user, Epoch: math.MaxInt64, Status: "removed"},
	} {
		if err := facts.Validate(); err != nil {
			t.Fatal("valid source shape rejected", err)
		}
	}
}
