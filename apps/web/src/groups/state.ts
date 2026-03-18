import type {
  Group,
  GroupChatSnapshot,
  GroupInviteLink,
  GroupMember,
  GroupMemberRole,
  GroupMessage,
} from "../gateway/types";
import type { GroupRealtimeEvent } from "./realtime";

export type GroupsSelectedState =
  | {
      status: "idle";
      snapshot: null;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      messages: GroupMessage[];
      errorMessage: null;
    }
  | {
      status: "loading";
      snapshot: null;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      messages: GroupMessage[];
      errorMessage: null;
    }
  | {
      status: "ready";
      snapshot: GroupChatSnapshot;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      messages: GroupMessage[];
      errorMessage: null;
    }
  | {
      status: "error";
      snapshot: null;
      members: GroupMember[];
      inviteLinks: GroupInviteLink[];
      messages: GroupMessage[];
      errorMessage: string;
    };

export function createInitialGroupsSelectedState(): GroupsSelectedState {
  return {
    status: "idle",
    snapshot: null,
    members: [],
    inviteLinks: [],
    messages: [],
    errorMessage: null,
  };
}

export function applyGroupRealtimeToGroups(
  groups: Group[],
  event: GroupRealtimeEvent,
): Group[] {
  switch (event.type) {
    case "group.message.updated":
      return sortGroups(upsertGroup(groups, event.group));
    case "group.membership.updated":
      if (event.group === null || event.selfMember === null) {
        return groups.filter((group) => group.id !== event.groupId);
      }
      return sortGroups(upsertGroup(groups, event.group));
    case "group.role.updated":
    case "group.ownership.transferred":
      if (event.group === null || event.selfMember === null) {
        return groups.filter((group) => group.id !== event.groupId);
      }
      return sortGroups(upsertGroup(groups, event.group));
    default:
      return groups;
  }
}

export function applyGroupRealtimeToSelectedState(
  state: GroupsSelectedState,
  event: GroupRealtimeEvent,
): GroupsSelectedState {
  if (state.status !== "ready") {
    return state;
  }

  const selectedGroupId = state.snapshot.group.id;
  const selectedThreadId = state.snapshot.thread.id;

  if (event.type === "group.message.updated") {
    if (event.group.id !== selectedGroupId) {
      return state;
    }

    return {
      status: "ready",
      snapshot: {
        group: event.group,
        thread: event.thread,
        typingState: state.snapshot.typingState,
      },
      members: state.members,
      inviteLinks: filterInviteLinks(state.inviteLinks, event.group.selfRole),
      messages: sortMessages(upsertMessage(state.messages, event.message)),
      errorMessage: null,
    };
  }

  if (event.type === "group.typing.updated") {
    if (event.groupId !== selectedGroupId || event.threadId !== selectedThreadId) {
      return state;
    }

    return {
      status: "ready",
      snapshot: {
        group: state.snapshot.group,
        thread: state.snapshot.thread,
        typingState: event.typingState,
      },
      members: state.members,
      inviteLinks: state.inviteLinks,
      messages: state.messages,
      errorMessage: null,
    };
  }

  if (event.groupId !== selectedGroupId) {
    return state;
  }

  if (event.group === null || event.thread === null || event.selfMember === null) {
    return createInitialGroupsSelectedState();
  }

  if (event.type === "group.membership.updated") {
    let members = state.members;
    if (event.reason === "member_removed" || event.reason === "member_left") {
      members = removeMember(members, event.affectedUserId);
    }
    if (event.reason === "member_joined" && event.member !== null) {
      members = upsertMember(members, event.member);
    }

    return {
      status: "ready",
      snapshot: {
        group: event.group,
        thread: event.thread,
        typingState: state.snapshot.typingState,
      },
      members: sortMembers(members),
      inviteLinks: filterInviteLinks(state.inviteLinks, event.group.selfRole),
      messages: state.messages,
      errorMessage: null,
    };
  }

  if (event.type === "group.role.updated") {
    return {
      status: "ready",
      snapshot: {
        group: event.group,
        thread: event.thread,
        typingState: state.snapshot.typingState,
      },
      members: sortMembers(
        upsertMember(
          upsertOptionalMember(state.members, event.selfMember),
          event.member,
        ),
      ),
      inviteLinks: filterInviteLinks(state.inviteLinks, event.group.selfRole),
      messages: state.messages,
      errorMessage: null,
    };
  }

  return {
    status: "ready",
    snapshot: {
      group: event.group,
      thread: event.thread,
      typingState: state.snapshot.typingState,
    },
    members: sortMembers(
      upsertOptionalMember(
        upsertMember(
          upsertMember(state.members, event.ownerMember),
          event.previousOwnerMember,
        ),
        event.selfMember,
      ),
    ),
    inviteLinks: filterInviteLinks(state.inviteLinks, event.group.selfRole),
    messages: state.messages,
    errorMessage: null,
  };
}

export function shouldClearSelectedGroupOnRealtimeEvent(
  state: GroupsSelectedState,
  event: GroupRealtimeEvent,
): boolean {
  if (state.status !== "ready") {
    return false;
  }

  if (event.type === "group.message.updated" || event.type === "group.typing.updated") {
    return false;
  }

  return (
    event.groupId === state.snapshot.group.id &&
    (event.group === null || event.thread === null || event.selfMember === null)
  );
}

function upsertGroup(groups: Group[], nextGroup: Group): Group[] {
  const nextGroups = groups.filter((group) => group.id !== nextGroup.id);
  nextGroups.push(nextGroup);
  return nextGroups;
}

function upsertMessage(messages: GroupMessage[], nextMessage: GroupMessage): GroupMessage[] {
  const nextMessages = messages.filter((message) => message.id !== nextMessage.id);
  nextMessages.push(nextMessage);
  return nextMessages;
}

function upsertMember(members: GroupMember[], nextMember: GroupMember): GroupMember[] {
  const nextMembers = members.filter((member) => member.user.id !== nextMember.user.id);
  nextMembers.push(nextMember);
  return nextMembers;
}

function upsertOptionalMember(
  members: GroupMember[],
  nextMember: GroupMember | null,
): GroupMember[] {
  if (nextMember === null) {
    return members;
  }

  return upsertMember(members, nextMember);
}

function removeMember(members: GroupMember[], userId: string): GroupMember[] {
  return members.filter((member) => member.user.id !== userId);
}

function filterInviteLinks(
  inviteLinks: GroupInviteLink[],
  selfRole: GroupMemberRole,
): GroupInviteLink[] {
  return canManageInviteLinks(selfRole) ? inviteLinks : [];
}

function canManageInviteLinks(role: GroupMemberRole): boolean {
  return role === "owner" || role === "admin";
}

function sortGroups(groups: Group[]): Group[] {
  return [...groups].sort((left, right) => {
    const byUpdatedAt = compareTimestampDesc(left.updatedAt, right.updatedAt);
    if (byUpdatedAt !== 0) {
      return byUpdatedAt;
    }

    return right.id.localeCompare(left.id);
  });
}

function sortMessages(messages: GroupMessage[]): GroupMessage[] {
  return [...messages].sort((left, right) => {
    const byCreatedAt = compareTimestampDesc(left.createdAt, right.createdAt);
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }

    return right.id.localeCompare(left.id);
  });
}

function sortMembers(members: GroupMember[]): GroupMember[] {
  return [...members].sort((left, right) => {
    const roleOrderDelta = roleOrder(left.role) - roleOrder(right.role);
    if (roleOrderDelta !== 0) {
      return roleOrderDelta;
    }

    const byJoinedAt = compareTimestampAsc(left.joinedAt, right.joinedAt);
    if (byJoinedAt !== 0) {
      return byJoinedAt;
    }

    return left.user.id.localeCompare(right.user.id);
  });
}

function roleOrder(role: GroupMemberRole): number {
  switch (role) {
    case "owner":
      return 0;
    case "admin":
      return 1;
    case "member":
      return 2;
    case "reader":
      return 3;
    default:
      return 4;
  }
}

function compareTimestampDesc(left: string, right: string): number {
  return compareTimestampAsc(right, left);
}

function compareTimestampAsc(left: string, right: string): number {
  const leftValue = parseTimestamp(left);
  const rightValue = parseTimestamp(right);
  if (leftValue !== rightValue) {
    return leftValue - rightValue;
  }

  return left.localeCompare(right);
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
