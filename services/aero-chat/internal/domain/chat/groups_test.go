package chat

import (
	"bytes"
	"context"
	"errors"
	"testing"
)

func TestCreateGroupAddsOwnerMembership(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")

	group, err := service.CreateGroup(context.Background(), alice.Token, "  Core team  ")
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	if group.Name != "Core team" {
		t.Fatalf("ожидалось нормализованное имя группы, получено %q", group.Name)
	}
	if group.SelfRole != GroupMemberRoleOwner {
		t.Fatalf("ожидалась роль owner, получено %q", group.SelfRole)
	}
	if group.MemberCount != 1 {
		t.Fatalf("ожидался один участник, получено %d", group.MemberCount)
	}

	groups, err := service.ListGroups(context.Background(), alice.Token)
	if err != nil {
		t.Fatalf("list groups: %v", err)
	}
	if len(groups) != 1 || groups[0].ID != group.ID {
		t.Fatal("ожидалась одна группа в списке владельца")
	}

	members, err := service.ListGroupMembers(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("list group members: %v", err)
	}
	if len(members) != 1 {
		t.Fatalf("ожидался один участник, получено %d", len(members))
	}
	if members[0].Role != GroupMemberRoleOwner {
		t.Fatalf("ожидалась роль owner у первого участника, получено %q", members[0].Role)
	}
}

func TestGroupInviteLinksRespectRoleScope(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{1}, 32))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")

	group := mustCreateGroup(t, service, alice.Token, "Ops")

	adminInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleAdmin)
	if err != nil {
		t.Fatalf("create admin invite link: %v", err)
	}
	if adminInvite.InviteLink.Role != GroupMemberRoleAdmin {
		t.Fatalf("ожидалась admin invite role, получено %q", adminInvite.InviteLink.Role)
	}

	joinedGroup, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, adminInvite.InviteToken)
	if err != nil {
		t.Fatalf("join group by admin invite: %v", err)
	}
	if joinedGroup.SelfRole != GroupMemberRoleAdmin {
		t.Fatalf("ожидалась admin роль после join, получено %q", joinedGroup.SelfRole)
	}

	if _, err := service.CreateGroupInviteLink(context.Background(), bob.Token, group.ID, GroupMemberRoleAdmin); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка запрета admin->admin invite, получено %v", err)
	}

	service.randReader = bytes.NewReader(bytes.Repeat([]byte{2}, 32))
	memberInvite, err := service.CreateGroupInviteLink(context.Background(), bob.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite as admin: %v", err)
	}

	joinedMemberGroup, err := service.JoinGroupByInviteLink(context.Background(), charlie.Token, memberInvite.InviteToken)
	if err != nil {
		t.Fatalf("join group by member invite: %v", err)
	}
	if joinedMemberGroup.SelfRole != GroupMemberRoleMember {
		t.Fatalf("ожидалась member роль после join, получено %q", joinedMemberGroup.SelfRole)
	}

	if _, err := service.ListGroupInviteLinks(context.Background(), charlie.Token, group.ID); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка доступа к invite links для member, получено %v", err)
	}
}

func TestDisableGroupInviteLinkPreventsJoin(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{3}, 32))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Readers")

	inviteLink, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleReader)
	if err != nil {
		t.Fatalf("create reader invite link: %v", err)
	}

	disabledInviteLink, err := service.DisableGroupInviteLink(context.Background(), alice.Token, group.ID, inviteLink.InviteLink.ID)
	if err != nil {
		t.Fatalf("disable invite link: %v", err)
	}
	if disabledInviteLink.DisabledAt == nil {
		t.Fatal("ожидался disabled_at после revoke invite link")
	}

	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, inviteLink.InviteToken); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка not found для disabled invite link, получено %v", err)
	}
}

func mustCreateGroup(t *testing.T, service *Service, token string, name string) *Group {
	t.Helper()

	group, err := service.CreateGroup(context.Background(), token, name)
	if err != nil {
		t.Fatalf("create group: %v", err)
	}

	return group
}
