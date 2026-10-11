package chat

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/google/uuid"
)

type groupAuthorityRepoFixture struct {
	facts GroupSubjectAuthorityFacts
	err   error
	calls int
}

func (r *groupAuthorityRepoFixture) GetGroupSubjectAuthorityFacts(_ context.Context, group, user string) (GroupSubjectAuthorityFacts, error) {
	r.calls++
	return r.facts, r.err
}

func TestGroupSubjectAuthorizationFreshRoleAndEpoch(t *testing.T) {
	group, user := uuid.NewString(), uuid.NewString()
	repo := &groupAuthorityRepoFixture{facts: GroupSubjectAuthorityFacts{GroupID: group, UserID: user, GroupExists: true, MembershipExists: true, AuthorityExists: true, Present: true, Eligible: true, Role: GroupMemberRoleMember, EligibilityEpoch: 1}}
	svc := NewGroupSubjectAuthorizer(repo)
	for _, role := range []string{GroupMemberRoleOwner, GroupMemberRoleAdmin, GroupMemberRoleMember} {
		repo.facts.Role = role
		current, err := svc.CheckGroupSubject(context.Background(), group, user)
		if err != nil || current.Role != role || current.EligibilityEpoch != 1 || current.Status != GroupSubjectPresent {
			t.Fatalf("fresh eligible authority=%+v err=%v", current, err)
		}
	}
	repo.facts.Role = GroupMemberRoleReader
	repo.facts.Eligible = false
	repo.facts.EligibilityEpoch = 2
	reader, err := svc.CheckGroupSubject(context.Background(), group, user)
	if err != nil || reader.Role != GroupMemberRoleReader || reader.EligibilityEpoch != 2 {
		t.Fatal("fresh reader transition not observed")
	}
	repo.facts.MembershipExists = false
	repo.facts.Present = false
	repo.facts.Role = ""
	repo.facts.EligibilityEpoch = 3
	removed, err := svc.CheckGroupSubject(context.Background(), group, user)
	if err != nil || removed.Status != GroupSubjectRemoved || removed.Role != "" || removed.EligibilityEpoch != 3 {
		t.Fatal("removed tombstone not observed")
	}
	repo.facts.GroupExists = false
	removed, err = svc.CheckGroupSubject(context.Background(), group, user)
	if err != nil || removed.Status != GroupSubjectRemoved {
		t.Fatal("group deletion lost retained negative authority")
	}
	repo.facts.AuthorityExists = false
	unknown, err := svc.CheckGroupSubject(context.Background(), group, user)
	if err != nil || unknown.Status != GroupSubjectNotFound || unknown.GroupID != "" || unknown.UserID != "" || unknown.EligibilityEpoch != 0 {
		t.Fatal("never-known pair fabricated authority")
	}
	if repo.calls != 7 {
		t.Fatalf("lookup calls=%d", repo.calls)
	}
}

func TestGroupSubjectAuthorizationMalformedAndBrokenStateDeny(t *testing.T) {
	group, user := uuid.NewString(), uuid.NewString()
	baseline := GroupSubjectAuthorityFacts{GroupID: group, UserID: user, GroupExists: true, MembershipExists: true, AuthorityExists: true, Present: true, Eligible: true, Role: GroupMemberRoleMember, EligibilityEpoch: 1}
	for name, change := range map[string]func(*GroupSubjectAuthorityFacts){
		"wrong_group":                func(f *GroupSubjectAuthorityFacts) { f.GroupID = uuid.NewString() },
		"wrong_user":                 func(f *GroupSubjectAuthorityFacts) { f.UserID = uuid.NewString() },
		"missing_authority":          func(f *GroupSubjectAuthorityFacts) { f.AuthorityExists = false },
		"missing_group":              func(f *GroupSubjectAuthorityFacts) { f.GroupExists = false },
		"missing_membership_present": func(f *GroupSubjectAuthorityFacts) { f.MembershipExists = false },
		"wrong_presence":             func(f *GroupSubjectAuthorityFacts) { f.Present = false },
		"wrong_class":                func(f *GroupSubjectAuthorityFacts) { f.Eligible = false },
		"unknown_role":               func(f *GroupSubjectAuthorityFacts) { f.Role = "unsupported" },
		"zero_revision":              func(f *GroupSubjectAuthorityFacts) { f.EligibilityEpoch = 0 },
		"negative_revision":          func(f *GroupSubjectAuthorityFacts) { f.EligibilityEpoch = -1 },
		"exhausted_eligible":         func(f *GroupSubjectAuthorityFacts) { f.EligibilityEpoch = math.MaxInt64 },
	} {
		t.Run(name, func(t *testing.T) {
			facts := baseline
			change(&facts)
			svc := NewGroupSubjectAuthorizer(&groupAuthorityRepoFixture{facts: facts})
			got, err := svc.CheckGroupSubject(context.Background(), group, user)
			if got != nil || !errors.Is(err, ErrGroupAuthorityUnavailable) {
				t.Fatalf("broken authority accepted %+v err=%v", got, err)
			}
		})
	}
	repo := &groupAuthorityRepoFixture{facts: baseline}
	for _, pair := range [][2]string{{"malformed-secret-marker", user}, {group, ""}, {uuid.Nil.String(), user}, {group, uuid.Nil.String()}} {
		if got, err := NewGroupSubjectAuthorizer(repo).CheckGroupSubject(context.Background(), pair[0], pair[1]); got != nil || !errors.Is(err, ErrInvalidArgument) {
			t.Fatal("malformed binding accepted")
		}
	}
	if repo.calls != 0 {
		t.Fatal("invalid IDs reached storage")
	}
	if got, err := NewGroupSubjectAuthorizer(nil).CheckGroupSubject(context.Background(), group, user); got != nil || !errors.Is(err, ErrGroupAuthorityUnavailable) {
		t.Fatal("nil repository accepted")
	}
	for _, failure := range []error{errors.New("secret database marker"), context.Canceled, context.DeadlineExceeded} {
		repo.err = failure
		got, err := NewGroupSubjectAuthorizer(repo).CheckGroupSubject(context.Background(), group, user)
		if got != nil || err == nil {
			t.Fatal("storage failure accepted")
		}
		if !errors.Is(failure, context.Canceled) && !errors.Is(failure, context.DeadlineExceeded) && !errors.Is(err, ErrGroupAuthorityUnavailable) {
			t.Fatal("raw database failure surfaced")
		}
	}
	repo.err = nil
	repo.facts.Role = GroupMemberRoleReader
	repo.facts.Eligible = false
	repo.facts.EligibilityEpoch = math.MaxInt64
	if got, err := NewGroupSubjectAuthorizer(repo).CheckGroupSubject(context.Background(), group, user); err != nil || got.Role != GroupMemberRoleReader {
		t.Fatal("denied exhausted epoch should remain observable")
	}
}
