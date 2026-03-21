import { describe, expect, it } from "vitest";
import {
  applyGroupRealtimeToGroups,
  applyGroupRealtimeToSelectedState,
  createInitialGroupsSelectedState,
  shouldClearSelectedGroupOnRealtimeEvent,
  type GroupsSelectedState,
} from "./state";
import type { GroupRealtimeEvent } from "./realtime";

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
        unreadCount: 0,
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
      },
      {
        user: { id: "user-2", login: "bob", nickname: "Bob", avatarUrl: null },
        role: "member",
        joinedAt: "2026-04-09T09:05:00Z",
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
      },
      thread: {
        ...state.snapshot.thread,
        canSendMessages: false,
      },
      member: {
        user: { id: "user-1", login: "alice", nickname: "Alice", avatarUrl: null },
        role: "reader",
        joinedAt: "2026-04-09T09:00:00Z",
      },
      selfMember: {
        user: { id: "user-1", login: "alice", nickname: "Alice", avatarUrl: null },
        role: "reader",
        joinedAt: "2026-04-09T09:00:00Z",
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
});
