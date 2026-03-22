import { describe, expect, it } from "vitest";
import type { GroupPermissions } from "../gateway/types";
import {
  applyGroupRealtimeToGroups,
  applyGroupRealtimeToSelectedState,
  createInitialGroupsSelectedState,
  shouldClearSelectedGroupOnRealtimeEvent,
  type GroupsSelectedState,
} from "./state";
import type { GroupRealtimeEvent } from "./realtime";

const ownerPermissions: GroupPermissions = {
  canManageInviteLinks: true,
  creatableInviteRoles: ["admin", "member", "reader"],
  canManageMemberRoles: true,
  roleManagementTargetRoles: ["admin", "member", "reader"],
  assignableRoles: ["admin", "member", "reader"],
  canTransferOwnership: true,
  removableMemberRoles: ["admin", "member", "reader"],
  restrictableMemberRoles: ["admin", "member", "reader"],
  canLeaveGroup: false,
};

const readerPermissions: GroupPermissions = {
  canManageInviteLinks: false,
  creatableInviteRoles: [],
  canManageMemberRoles: false,
  roleManagementTargetRoles: [],
  assignableRoles: [],
  canTransferOwnership: false,
  removableMemberRoles: [],
  restrictableMemberRoles: [],
  canLeaveGroup: true,
};

function createReadyState(): Extract<GroupsSelectedState, { status: "ready" }> {
  return {
    status: "ready",
    snapshot: {
      group: {
        id: "group-1",
        name: "Ops Room",
        kind: "CHAT_KIND_GROUP",
        selfRole: "owner",
        memberCount: 2,
        encryptedPinnedMessageIds: [],
        unreadCount: 0,
        encryptedUnreadCount: 0,
        permissions: ownerPermissions,
        createdAt: "2026-04-09T09:00:00Z",
        updatedAt: "2026-04-10T12:00:00Z",
      },
      thread: {
        id: "thread-1",
        groupId: "group-1",
        threadKey: "primary",
        canSendMessages: true,
        createdAt: "2026-04-09T09:00:00Z",
        updatedAt: "2026-04-10T12:00:00Z",
      },
      readState: null,
      encryptedReadState: null,
      typingState: {
        threadId: "thread-1",
        typers: [],
      },
    },
    members: [
      {
        user: { id: "user-1", login: "alice", nickname: "Alice", avatarUrl: null },
        role: "owner",
        joinedAt: "2026-04-09T09:00:00Z",
        isWriteRestricted: false,
        writeRestrictedAt: null,
      },
      {
        user: { id: "user-2", login: "bob", nickname: "Bob", avatarUrl: null },
        role: "member",
        joinedAt: "2026-04-09T09:05:00Z",
        isWriteRestricted: false,
        writeRestrictedAt: null,
      },
    ],
    inviteLinks: [
      {
        id: "invite-1",
        groupId: "group-1",
        role: "member",
        createdByUserId: "user-1",
        joinCount: 0,
        createdAt: "2026-04-10T11:00:00Z",
        updatedAt: "2026-04-10T11:00:00Z",
        disabledAt: null,
        lastJoinedAt: null,
      },
    ],
    messages: [
      {
        id: "message-1",
        groupId: "group-1",
        threadId: "thread-1",
        senderUserId: "user-1",
        kind: "MESSAGE_KIND_TEXT",
        text: {
          text: "older",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
        },
        attachments: [],
        createdAt: "2026-04-10T11:00:00Z",
        updatedAt: "2026-04-10T11:00:00Z",
        editedAt: null,
      },
    ],
    errorMessage: null,
  };
}

describe("group realtime state helpers", () => {
  it("applies message updates idempotently and keeps newest-first history", () => {
    const state = createReadyState();
    const event: GroupRealtimeEvent = {
      type: "group.message.updated",
      reason: "message_created",
      group: {
        ...state.snapshot.group,
        updatedAt: "2026-04-10T12:05:00Z",
      },
      thread: {
        ...state.snapshot.thread,
        updatedAt: "2026-04-10T12:05:00Z",
      },
      message: {
        id: "message-2",
        groupId: "group-1",
        threadId: "thread-1",
        senderUserId: "user-2",
        kind: "MESSAGE_KIND_TEXT",
        text: {
          text: "newest",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
        },
        attachments: [],
        createdAt: "2026-04-10T12:05:00Z",
        updatedAt: "2026-04-10T12:05:00Z",
        editedAt: null,
      },
    };

    const nextState = applyGroupRealtimeToSelectedState(state, event, "user-1");
    const duplicatedState = applyGroupRealtimeToSelectedState(nextState, event, "user-1");

    expect(nextState.status).toBe("ready");
    if (duplicatedState.status !== "ready") {
      throw new Error("expected ready state");
    }

    expect(duplicatedState.messages).toHaveLength(2);
    expect(duplicatedState.messages[0]?.id).toBe("message-2");
    expect(duplicatedState.messages[1]?.id).toBe("message-1");
  });

  it("drops selected state and group list when current user loses membership", () => {
    const state = createReadyState();
    const event: GroupRealtimeEvent = {
      type: "group.membership.updated",
      reason: "member_removed",
      groupId: "group-1",
      group: null,
      thread: null,
      affectedUserId: "user-1",
      member: null,
      selfMember: null,
    };

    const nextState = applyGroupRealtimeToSelectedState(state, event, "user-1");
    const nextGroups = applyGroupRealtimeToGroups([state.snapshot.group], event, "user-1");

    expect(shouldClearSelectedGroupOnRealtimeEvent(state, event)).toBe(true);
    expect(nextState).toEqual(createInitialGroupsSelectedState());
    expect(nextGroups).toEqual([]);
  });

  it("applies viewer-relative role updates and clears invite links for reader", () => {
    const state = createReadyState();
    const event: GroupRealtimeEvent = {
      type: "group.role.updated",
      groupId: "group-1",
      group: {
        ...state.snapshot.group,
        selfRole: "reader",
        permissions: readerPermissions,
      },
      thread: {
        ...state.snapshot.thread,
        canSendMessages: false,
      },
      member: {
        user: { id: "user-1", login: "alice", nickname: "Alice", avatarUrl: null },
        role: "reader",
        joinedAt: "2026-04-09T09:00:00Z",
        isWriteRestricted: false,
        writeRestrictedAt: null,
      },
      selfMember: {
        user: { id: "user-1", login: "alice", nickname: "Alice", avatarUrl: null },
        role: "reader",
        joinedAt: "2026-04-09T09:00:00Z",
        isWriteRestricted: false,
        writeRestrictedAt: null,
      },
      previousRole: "owner",
    };

    const nextState = applyGroupRealtimeToSelectedState(state, event, "user-1");

    expect(nextState.status).toBe("ready");
    if (nextState.status !== "ready") {
      throw new Error("expected ready state");
    }

    expect(nextState.snapshot.group.selfRole).toBe("reader");
    expect(nextState.snapshot.thread.canSendMessages).toBe(false);
    expect(nextState.inviteLinks).toEqual([]);
    expect(nextState.members[0]?.role).toBe("member");
    expect(nextState.members[1]?.role).toBe("reader");
  });

  it("replaces typing state idempotently for the active thread", () => {
    const state = createReadyState();
    const event: GroupRealtimeEvent = {
      type: "group.typing.updated",
      groupId: "group-1",
      threadId: "thread-1",
      typingState: {
        threadId: "thread-1",
        typers: [
          {
            user: { id: "user-2", login: "bob", nickname: "Bob", avatarUrl: null },
            updatedAt: "2026-04-10T12:06:00Z",
            expiresAt: "2026-04-10T12:06:06Z",
          },
        ],
      },
    };

    const nextState = applyGroupRealtimeToSelectedState(state, event, "user-1");
    const duplicatedState = applyGroupRealtimeToSelectedState(nextState, event, "user-1");

    expect(duplicatedState.status).toBe("ready");
    if (duplicatedState.status !== "ready") {
      throw new Error("expected ready state");
    }

    expect(duplicatedState.snapshot.typingState?.typers).toHaveLength(1);
    expect(duplicatedState.snapshot.typingState?.typers[0]?.user.id).toBe("user-2");
  });

  it("does not increment unread count for group message edit realtime", () => {
    const state = createReadyState();
    const event: GroupRealtimeEvent = {
      type: "group.message.updated",
      reason: "message_edited",
      group: {
        ...state.snapshot.group,
        updatedAt: "2026-04-10T12:07:00Z",
      },
      thread: {
        ...state.snapshot.thread,
        updatedAt: "2026-04-10T12:07:00Z",
      },
      message: {
        ...state.messages[0]!,
        senderUserId: "user-2",
        text: {
          text: "edited",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
        },
        updatedAt: "2026-04-10T12:07:00Z",
        editedAt: "2026-04-10T12:07:00Z",
      },
    };

    const nextGroups = applyGroupRealtimeToGroups([state.snapshot.group], event, "user-1");
    expect(nextGroups[0]?.unreadCount).toBe(0);
  });

  it("replaces encrypted group read state and unread counters", () => {
    const state = createReadyState();
    const event: GroupRealtimeEvent = {
      type: "group.read.updated",
      groupId: "group-1",
      readState: null,
      unreadCount: 0,
      encryptedReadState: {
        selfPosition: {
          messageId: "encrypted-1",
          messageCreatedAt: "2026-04-10T12:08:00Z",
          updatedAt: "2026-04-10T12:09:00Z",
        },
      },
      encryptedUnreadCount: 1,
    };

    const nextState = applyGroupRealtimeToSelectedState(state, event, "user-1");
    const nextGroups = applyGroupRealtimeToGroups([state.snapshot.group], event, "user-1");

    if (nextState.status !== "ready") {
      throw new Error("expected ready state");
    }

    expect(nextState.snapshot.encryptedReadState?.selfPosition?.messageId).toBe("encrypted-1");
    expect(nextState.snapshot.group.encryptedUnreadCount).toBe(1);
    expect(nextGroups[0]?.encryptedUnreadCount).toBe(1);
  });
});
