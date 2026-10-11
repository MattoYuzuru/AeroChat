package chat

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/google/uuid"
)

var ErrGroupAuthorityUnavailable = errors.New("group authority unavailable")

type GroupSubjectAuthorityStatus string

const (
	GroupSubjectPresent  GroupSubjectAuthorityStatus = "present"
	GroupSubjectRemoved  GroupSubjectAuthorityStatus = "removed"
	GroupSubjectNotFound GroupSubjectAuthorityStatus = "not_found"
)

type GroupSubjectAuthority struct {
	GroupID          string
	UserID           string
	EligibilityEpoch int64
	Status           GroupSubjectAuthorityStatus
	Role             string
}

type GroupSubjectAuthorityFacts struct {
	GroupID          string
	UserID           string
	GroupExists      bool
	MembershipExists bool
	AuthorityExists  bool
	EligibilityEpoch int64
	Present          bool
	Eligible         bool
	Role             string
}

type GroupAuthorityRepository interface {
	GetGroupSubjectAuthorityFacts(context.Context, string, string) (GroupSubjectAuthorityFacts, error)
}

type GroupSubjectAuthorizer struct{ repo GroupAuthorityRepository }

func NewGroupSubjectAuthorizer(repo GroupAuthorityRepository) *GroupSubjectAuthorizer {
	return &GroupSubjectAuthorizer{repo: repo}
}

func (s *GroupSubjectAuthorizer) CheckGroupSubject(ctx context.Context, groupID, userID string) (*GroupSubjectAuthority, error) {
	group, err := uuid.Parse(strings.TrimSpace(groupID))
	if err != nil || group == uuid.Nil {
		return nil, ErrInvalidArgument
	}
	user, err := uuid.Parse(strings.TrimSpace(userID))
	if err != nil || user == uuid.Nil {
		return nil, ErrInvalidArgument
	}
	if s.repo == nil {
		return nil, ErrGroupAuthorityUnavailable
	}
	facts, err := s.repo.GetGroupSubjectAuthorityFacts(ctx, group.String(), user.String())
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return nil, err
		}
		return nil, ErrGroupAuthorityUnavailable
	}
	if facts.GroupID != group.String() || facts.UserID != user.String() {
		return nil, ErrGroupAuthorityUnavailable
	}
	if !facts.AuthorityExists {
		if facts.MembershipExists {
			return nil, ErrGroupAuthorityUnavailable
		}
		return &GroupSubjectAuthority{Status: GroupSubjectNotFound}, nil
	}
	if facts.EligibilityEpoch <= 0 {
		return nil, ErrGroupAuthorityUnavailable
	}
	result := &GroupSubjectAuthority{GroupID: facts.GroupID, UserID: facts.UserID, EligibilityEpoch: facts.EligibilityEpoch}
	if !facts.MembershipExists {
		if facts.Present || facts.Eligible {
			return nil, ErrGroupAuthorityUnavailable
		}
		result.Status = GroupSubjectRemoved
		return result, nil
	}
	if !facts.GroupExists || !facts.Present {
		return nil, ErrGroupAuthorityUnavailable
	}
	eligible := false
	switch facts.Role {
	case GroupMemberRoleOwner, GroupMemberRoleAdmin, GroupMemberRoleMember:
		eligible = true
	case GroupMemberRoleReader:
	default:
		return nil, ErrGroupAuthorityUnavailable
	}
	if facts.Eligible != eligible || (eligible && facts.EligibilityEpoch == math.MaxInt64) {
		return nil, ErrGroupAuthorityUnavailable
	}
	result.Status = GroupSubjectPresent
	result.Role = facts.Role
	return result, nil
}
