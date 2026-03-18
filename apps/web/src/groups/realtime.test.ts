import { describe, expect, it } from "vitest";
import { parseGroupRealtimeEvent } from "./realtime";

describe("parseGroupRealtimeEvent", () => {
  it("normalizes group message update payload", () => {
    const event = parseGroupRealtimeEvent({
      id: "evt-group-message-1",
      type: "group.message.updated",
      issuedAt: "2026-04-10T12:00:00Z",
      payload: {
        reason: "message_created",
        group: {
          id: "group-1",
          name: "Ops Room",
          kind: "CHAT_KIND_GROUP",
          selfRole: "GROUP_MEMBER_ROLE_OWNER",
          memberCount: 3,
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
        message: {
          id: "message-1",
          groupId: "group-1",
          threadId: "thread-1",
          senderUserId: "user-1",
          kind: "MESSAGE_KIND_TEXT",
          text: {
            text: "hello group",
            markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
          },
          createdAt: "2026-04-10T12:00:00Z",
          updatedAt: "2026-04-10T12:00:00Z",
        },
      },
    });

    expect(event).toEqual({
      type: "group.message.updated",
      reason: "message_created",
      group: expect.objectContaining({
        id: "group-1",
        selfRole: "owner",
      }),
      thread: expect.objectContaining({
        id: "thread-1",
        canSendMessages: true,
      }),
      message: expect.objectContaining({
        id: "message-1",
        groupId: "group-1",
      }),
    });
  });

  it("normalizes membership removal payload for affected user", () => {
    const event = parseGroupRealtimeEvent({
      id: "evt-group-membership-1",
      type: "group.membership.updated",
      issuedAt: "2026-04-10T12:02:00Z",
      payload: {
        reason: "member_removed",
        groupId: "group-1",
        affectedUserId: "user-2",
      },
    });

    expect(event).toEqual({
      type: "group.membership.updated",
      reason: "member_removed",
      groupId: "group-1",
      group: null,
      thread: null,
      affectedUserId: "user-2",
      member: null,
      selfMember: null,
    });
  });

  it("normalizes role update payload into viewer-friendly roles", () => {
    const event = parseGroupRealtimeEvent({
      id: "evt-group-role-1",
      type: "group.role.updated",
      issuedAt: "2026-04-10T12:03:00Z",
      payload: {
        groupId: "group-1",
        group: {
          id: "group-1",
          name: "Ops Room",
          kind: "CHAT_KIND_GROUP",
          selfRole: "GROUP_MEMBER_ROLE_READER",
          memberCount: 2,
          createdAt: "2026-04-09T09:00:00Z",
          updatedAt: "2026-04-10T12:03:00Z",
        },
        thread: {
          id: "thread-1",
          groupId: "group-1",
          threadKey: "primary",
          canSendMessages: false,
          createdAt: "2026-04-09T09:00:00Z",
          updatedAt: "2026-04-10T12:00:00Z",
        },
        previousRole: "GROUP_MEMBER_ROLE_MEMBER",
        member: {
          user: {
            id: "user-2",
            login: "Bob",
            nickname: "Bob",
          },
          role: "GROUP_MEMBER_ROLE_READER",
          joinedAt: "2026-04-09T10:00:00Z",
        },
        selfMember: {
          user: {
            id: "user-2",
            login: "Bob",
            nickname: "Bob",
          },
          role: "GROUP_MEMBER_ROLE_READER",
          joinedAt: "2026-04-09T10:00:00Z",
        },
      },
    });

    expect(event).toEqual({
      type: "group.role.updated",
      groupId: "group-1",
      group: expect.objectContaining({
        selfRole: "reader",
      }),
      thread: expect.objectContaining({
        canSendMessages: false,
      }),
      member: expect.objectContaining({
        role: "reader",
      }),
      selfMember: expect.objectContaining({
        role: "reader",
      }),
      previousRole: "member",
    });
  });
});
