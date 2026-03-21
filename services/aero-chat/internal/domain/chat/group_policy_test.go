package chat

import "testing"

func TestBuildGroupPermissionsMatrix(t *testing.T) {
	t.Parallel()

	owner := buildGroupPermissions(GroupMemberRoleOwner)
	if !owner.CanManageInviteLinks || !owner.CanManageMemberRoles || !owner.CanTransferOwnership {
		t.Fatalf("owner policy должна содержать полный management surface, получено %+v", owner)
	}
	assertGroupRoles(t, owner.CreatableInviteRoles, GroupMemberRoleAdmin, GroupMemberRoleMember, GroupMemberRoleReader)
	assertGroupRoles(t, owner.RoleManagementTargetRoles, GroupMemberRoleAdmin, GroupMemberRoleMember, GroupMemberRoleReader)
	assertGroupRoles(t, owner.AssignableRoles, GroupMemberRoleAdmin, GroupMemberRoleMember, GroupMemberRoleReader)
	assertGroupRoles(t, owner.RemovableMemberRoles, GroupMemberRoleAdmin, GroupMemberRoleMember, GroupMemberRoleReader)
	assertGroupRoles(t, owner.RestrictableMemberRoles, GroupMemberRoleAdmin, GroupMemberRoleMember, GroupMemberRoleReader)
	if owner.CanLeaveGroup {
		t.Fatalf("owner не должен получать can_leave_group, получено %+v", owner)
	}

	admin := buildGroupPermissions(GroupMemberRoleAdmin)
	if !admin.CanManageInviteLinks || admin.CanManageMemberRoles || admin.CanTransferOwnership {
		t.Fatalf("admin policy не соответствует bounded matrix, получено %+v", admin)
	}
	assertGroupRoles(t, admin.CreatableInviteRoles, GroupMemberRoleMember, GroupMemberRoleReader)
	assertGroupRoles(t, admin.RemovableMemberRoles, GroupMemberRoleMember, GroupMemberRoleReader)
	assertGroupRoles(t, admin.RestrictableMemberRoles, GroupMemberRoleMember, GroupMemberRoleReader)
	if !admin.CanLeaveGroup {
		t.Fatalf("admin должен иметь can_leave_group, получено %+v", admin)
	}

	member := buildGroupPermissions(GroupMemberRoleMember)
	if member.CanManageInviteLinks || member.CanManageMemberRoles || member.CanTransferOwnership {
		t.Fatalf("member policy не должна содержать management powers, получено %+v", member)
	}
	if !member.CanLeaveGroup {
		t.Fatalf("member должен иметь can_leave_group, получено %+v", member)
	}

	reader := buildGroupPermissions(GroupMemberRoleReader)
	if reader.CanManageInviteLinks || reader.CanManageMemberRoles || reader.CanTransferOwnership {
		t.Fatalf("reader policy не должна содержать management powers, получено %+v", reader)
	}
	if !reader.CanLeaveGroup {
		t.Fatalf("reader должен иметь can_leave_group, получено %+v", reader)
	}
}

func TestCanSendGroupMessagesRespectsRoleAndRestriction(t *testing.T) {
	t.Parallel()

	if !canSendGroupMessages(GroupMemberRoleOwner, false) {
		t.Fatal("owner должен уметь отправлять сообщения без restriction")
	}
	if !canSendGroupMessages(GroupMemberRoleAdmin, false) {
		t.Fatal("admin должен уметь отправлять сообщения без restriction")
	}
	if !canSendGroupMessages(GroupMemberRoleMember, false) {
		t.Fatal("member должен уметь отправлять сообщения без restriction")
	}
	if canSendGroupMessages(GroupMemberRoleReader, false) {
		t.Fatal("reader не должен уметь отправлять сообщения")
	}
	if canSendGroupMessages(GroupMemberRoleMember, true) {
		t.Fatal("write restriction должен запрещать отправку даже для member")
	}
}

func assertGroupRoles(t *testing.T, actual []string, expected ...string) {
	t.Helper()

	if len(actual) != len(expected) {
		t.Fatalf("ожидались роли %v, получено %v", expected, actual)
	}
	for index := range expected {
		if actual[index] != expected[index] {
			t.Fatalf("ожидались роли %v, получено %v", expected, actual)
		}
	}
}
