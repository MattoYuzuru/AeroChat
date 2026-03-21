package chat

type groupRolePolicy struct {
	canManageInviteLinks      bool
	creatableInviteRoles      []string
	canManageMemberRoles      bool
	roleManagementTargetRoles []string
	assignableRoles           []string
	canTransferOwnership      bool
	removableMemberRoles      []string
	restrictableMemberRoles   []string
	canLeaveGroup             bool
	canSendMessages           bool
}

var groupRolePolicies = map[string]groupRolePolicy{
	GroupMemberRoleOwner: {
		canManageInviteLinks:      true,
		creatableInviteRoles:      []string{GroupMemberRoleAdmin, GroupMemberRoleMember, GroupMemberRoleReader},
		canManageMemberRoles:      true,
		roleManagementTargetRoles: []string{GroupMemberRoleAdmin, GroupMemberRoleMember, GroupMemberRoleReader},
		assignableRoles:           []string{GroupMemberRoleAdmin, GroupMemberRoleMember, GroupMemberRoleReader},
		canTransferOwnership:      true,
		removableMemberRoles:      []string{GroupMemberRoleAdmin, GroupMemberRoleMember, GroupMemberRoleReader},
		restrictableMemberRoles:   []string{GroupMemberRoleAdmin, GroupMemberRoleMember, GroupMemberRoleReader},
		canLeaveGroup:             false,
		canSendMessages:           true,
	},
	GroupMemberRoleAdmin: {
		canManageInviteLinks:    true,
		creatableInviteRoles:    []string{GroupMemberRoleMember, GroupMemberRoleReader},
		removableMemberRoles:    []string{GroupMemberRoleMember, GroupMemberRoleReader},
		restrictableMemberRoles: []string{GroupMemberRoleMember, GroupMemberRoleReader},
		canLeaveGroup:           true,
		canSendMessages:         true,
	},
	GroupMemberRoleMember: {
		canLeaveGroup:   true,
		canSendMessages: true,
	},
	GroupMemberRoleReader: {
		canLeaveGroup: true,
	},
}

func buildGroupPermissions(role string) GroupPermissions {
	policy := policyForGroupRole(role)
	return GroupPermissions{
		CanManageInviteLinks:      policy.canManageInviteLinks,
		CreatableInviteRoles:      cloneStringSlice(policy.creatableInviteRoles),
		CanManageMemberRoles:      policy.canManageMemberRoles,
		RoleManagementTargetRoles: cloneStringSlice(policy.roleManagementTargetRoles),
		AssignableRoles:           cloneStringSlice(policy.assignableRoles),
		CanTransferOwnership:      policy.canTransferOwnership,
		RemovableMemberRoles:      cloneStringSlice(policy.removableMemberRoles),
		RestrictableMemberRoles:   cloneStringSlice(policy.restrictableMemberRoles),
		CanLeaveGroup:             policy.canLeaveGroup,
	}
}

func canManageGroupInviteLinks(role string) bool {
	return policyForGroupRole(role).canManageInviteLinks
}

func canManageGroupMemberRoles(role string) bool {
	return policyForGroupRole(role).canManageMemberRoles
}

func canTransferGroupOwnership(role string) bool {
	return policyForGroupRole(role).canTransferOwnership
}

func canSendGroupMessages(role string, isWriteRestricted bool) bool {
	if isWriteRestricted {
		return false
	}

	return policyForGroupRole(role).canSendMessages
}

func canCreateInviteForRole(actorRole string, targetRole string) bool {
	return containsGroupRole(policyForGroupRole(actorRole).creatableInviteRoles, targetRole)
}

func canManageRoleForTarget(actorRole string, targetRole string) bool {
	return containsGroupRole(policyForGroupRole(actorRole).roleManagementTargetRoles, targetRole)
}

func canAssignGroupRole(actorRole string, targetRole string) bool {
	return containsGroupRole(policyForGroupRole(actorRole).assignableRoles, targetRole)
}

func canRemoveGroupMember(actorRole string, targetRole string) bool {
	return containsGroupRole(policyForGroupRole(actorRole).removableMemberRoles, targetRole)
}

func canRestrictGroupMember(actorRole string, targetRole string) bool {
	return containsGroupRole(policyForGroupRole(actorRole).restrictableMemberRoles, targetRole)
}

func policyForGroupRole(role string) groupRolePolicy {
	if policy, ok := groupRolePolicies[role]; ok {
		return policy
	}

	return groupRolePolicy{}
}

func containsGroupRole(roles []string, role string) bool {
	for _, candidate := range roles {
		if candidate == role {
			return true
		}
	}

	return false
}

func cloneStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	return append([]string(nil), values...)
}
