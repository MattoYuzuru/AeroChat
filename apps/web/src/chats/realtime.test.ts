import { describe, expect, it } from "vitest";
import { parseDirectChatRealtimeEvent } from "./realtime";

describe("parseDirectChatRealtimeEvent", () => {
  it("normalizes direct chat message update payload", () => {
    const event = parseDirectChatRealtimeEvent({
      id: "evt-1",
      type: "direct_chat.message.updated",
      issuedAt: "2026-04-06T12:00:00Z",
      payload: {
        reason: "message_created",
        chat: {
          id: "chat-1",
          kind: "CHAT_KIND_DIRECT",
          participants: [
            { id: "user-1", login: "alice", nickname: "Alice" },
            { id: "user-2", login: "bob", nickname: "Bob" },
          ],
          pinnedMessageIds: [],
          createdAt: "2026-04-06T11:59:00Z",
          updatedAt: "2026-04-06T12:00:00Z",
        },
        message: {
          id: "message-1",
          chatId: "chat-1",
          senderUserId: "user-1",
          kind: "MESSAGE_KIND_TEXT",
          text: {
            text: "hello",
            markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
          },
          pinned: false,
          createdAt: "2026-04-06T12:00:00Z",
          updatedAt: "2026-04-06T12:00:00Z",
        },
      },
    });

    expect(event).toEqual({
      type: "direct_chat.message.updated",
      reason: "message_created",
      chat: expect.objectContaining({
        id: "chat-1",
        participants: expect.arrayContaining([
          expect.objectContaining({ id: "user-1" }),
        ]),
      }),
      message: expect.objectContaining({
        id: "message-1",
        chatId: "chat-1",
      }),
    });
  });

  it("normalizes viewer-relative read state payload", () => {
    const event = parseDirectChatRealtimeEvent({
      id: "evt-2",
      type: "direct_chat.read.updated",
      issuedAt: "2026-04-06T12:01:00Z",
      payload: {
        chatId: "chat-1",
        readState: {
          selfPosition: null,
          peerPosition: {
            messageId: "message-4",
            messageCreatedAt: "2026-04-06T12:00:30Z",
            updatedAt: "2026-04-06T12:01:00Z",
          },
        },
      },
    });

    expect(event).toEqual({
      type: "direct_chat.read.updated",
      chatId: "chat-1",
      readState: {
        selfPosition: null,
        peerPosition: {
          messageId: "message-4",
          messageCreatedAt: "2026-04-06T12:00:30Z",
          updatedAt: "2026-04-06T12:01:00Z",
        },
      },
    });
  });

  it("ignores malformed payloads", () => {
    const event = parseDirectChatRealtimeEvent({
      id: "evt-3",
      type: "direct_chat.message.updated",
      issuedAt: "2026-04-06T12:02:00Z",
      payload: {
        reason: "message_created",
      },
    });

    expect(event).toBeNull();
  });
});
