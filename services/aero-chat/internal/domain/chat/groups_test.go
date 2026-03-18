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

func TestUpdateGroupMemberRoleRequiresOwnerAndKeepsOwnerUnique(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{4}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Ops")

	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join group by member invite: %v", err)
	}

	if _, err := service.UpdateGroupMemberRole(context.Background(), bob.Token, group.ID, bob.User.ID, GroupMemberRoleAdmin); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка owner-only role management, получено %v", err)
	}

	updatedMember, err := service.UpdateGroupMemberRole(context.Background(), alice.Token, group.ID, bob.User.ID, GroupMemberRoleAdmin)
	if err != nil {
		t.Fatalf("promote member to admin: %v", err)
	}
	if updatedMember.Role != GroupMemberRoleAdmin {
		t.Fatalf("ожидалась роль admin после promote, получено %q", updatedMember.Role)
	}

	updatedMember, err = service.UpdateGroupMemberRole(context.Background(), alice.Token, group.ID, bob.User.ID, GroupMemberRoleReader)
	if err != nil {
		t.Fatalf("demote admin to reader: %v", err)
	}
	if updatedMember.Role != GroupMemberRoleReader {
		t.Fatalf("ожидалась роль reader после demote, получено %q", updatedMember.Role)
	}

	if _, err := service.UpdateGroupMemberRole(context.Background(), alice.Token, group.ID, bob.User.ID, GroupMemberRoleOwner); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка explicit transfer required для owner role, получено %v", err)
	}
	if _, err := service.UpdateGroupMemberRole(context.Background(), alice.Token, group.ID, alice.User.ID, GroupMemberRoleAdmin); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка запрета self-demote owner, получено %v", err)
	}

	members, err := service.ListGroupMembers(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("list members after role changes: %v", err)
	}
	if countMembersByRole(members, GroupMemberRoleOwner) != 1 {
		t.Fatalf("ожидался ровно один owner после role changes, получено %d", countMembersByRole(members, GroupMemberRoleOwner))
	}
}

func TestTransferGroupOwnershipIsExplicitAndUnblocksOwnerLeave(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{5}, 64))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	group := mustCreateGroup(t, service, alice.Token, "Owners")

	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join group by member invite: %v", err)
	}

	if err := service.LeaveGroup(context.Background(), alice.Token, group.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка owner-leave requires transfer, получено %v", err)
	}

	transferredGroup, err := service.TransferGroupOwnership(context.Background(), alice.Token, group.ID, bob.User.ID)
	if err != nil {
		t.Fatalf("transfer ownership: %v", err)
	}
	if transferredGroup.SelfRole != GroupMemberRoleAdmin {
		t.Fatalf("ожидалась роль admin у прежнего owner после transfer, получено %q", transferredGroup.SelfRole)
	}

	bobGroup, err := service.GetGroup(context.Background(), bob.Token, group.ID)
	if err != nil {
		t.Fatalf("get group as new owner: %v", err)
	}
	if bobGroup.SelfRole != GroupMemberRoleOwner {
		t.Fatalf("ожидалась роль owner у Bob после transfer, получено %q", bobGroup.SelfRole)
	}

	members, err := service.ListGroupMembers(context.Background(), bob.Token, group.ID)
	if err != nil {
		t.Fatalf("list members after transfer: %v", err)
	}
	if countMembersByRole(members, GroupMemberRoleOwner) != 1 {
		t.Fatalf("ожидался ровно один owner после transfer, получено %d", countMembersByRole(members, GroupMemberRoleOwner))
	}

	if err := service.LeaveGroup(context.Background(), alice.Token, group.ID); err != nil {
		t.Fatalf("leave group after transfer: %v", err)
	}

	if _, err := service.GetGroup(context.Background(), alice.Token, group.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась потеря доступа после leave, получено %v", err)
	}

	finalGroup, err := service.GetGroup(context.Background(), bob.Token, group.ID)
	if err != nil {
		t.Fatalf("get group as remaining owner: %v", err)
	}
	if finalGroup.MemberCount != 1 {
		t.Fatalf("ожидался один участник после ухода прежнего owner, получено %d", finalGroup.MemberCount)
	}
	if finalGroup.SelfRole != GroupMemberRoleOwner {
		t.Fatalf("ожидалась сохранённая роль owner у оставшегося участника, получено %q", finalGroup.SelfRole)
	}
}

func TestRemoveGroupMemberAndLeaveGroupAreBounded(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.randReader = bytes.NewReader(bytes.Repeat([]byte{6}, 96))

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")

	group := mustCreateGroup(t, service, alice.Token, "Members")

	adminInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleAdmin)
	if err != nil {
		t.Fatalf("create admin invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, adminInvite.InviteToken); err != nil {
		t.Fatalf("join admin invite: %v", err)
	}

	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), charlie.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join member invite: %v", err)
	}

	if err := service.RemoveGroupMember(context.Background(), bob.Token, group.ID, charlie.User.ID); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка admin cannot remove members in this PR, получено %v", err)
	}
	if err := service.RemoveGroupMember(context.Background(), alice.Token, group.ID, alice.User.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка owner self-remove via remove command, получено %v", err)
	}

	if err := service.RemoveGroupMember(context.Background(), alice.Token, group.ID, charlie.User.ID); err != nil {
		t.Fatalf("remove member: %v", err)
	}
	if _, err := service.GetGroup(context.Background(), charlie.Token, group.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась потеря доступа удалённого участника, получено %v", err)
	}

	if err := service.LeaveGroup(context.Background(), bob.Token, group.ID); err != nil {
		t.Fatalf("admin leave group: %v", err)
	}
	if _, err := service.GetGroup(context.Background(), bob.Token, group.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась потеря доступа после self leave, получено %v", err)
	}

	finalGroup, err := service.GetGroup(context.Background(), alice.Token, group.ID)
	if err != nil {
		t.Fatalf("get group after remove and leave: %v", err)
	}
	if finalGroup.MemberCount != 1 {
		t.Fatalf("ожидался один участник после remove и leave, получено %d", finalGroup.MemberCount)
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

func countMembersByRole(members []GroupMember, role string) int {
	count := 0
	for _, member := range members {
		if member.Role == role {
			count++
		}
	}

	return count
}
