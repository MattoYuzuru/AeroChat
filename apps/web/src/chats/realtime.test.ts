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
          attachments: [
            {
              id: "attachment-1",
              ownerUserId: "user-1",
              scope: "ATTACHMENT_SCOPE_DIRECT_CHAT",
              directChatId: "chat-1",
              fileName: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 2048,
              status: "ATTACHMENT_STATUS_ATTACHED",
              createdAt: "2026-04-06T12:00:00Z",
              updatedAt: "2026-04-06T12:00:00Z",
            },
          ],
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
        attachments: [
          expect.objectContaining({
            id: "attachment-1",
            fileName: "report.pdf",
          }),
        ],
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
      unreadCount: null,
    });
  });

  it("normalizes viewer-relative typing state payload", () => {
    const event = parseDirectChatRealtimeEvent({
      id: "evt-typing-1",
      type: "direct_chat.typing.updated",
      issuedAt: "2026-04-07T12:01:00Z",
      payload: {
        chatId: "chat-1",
        typingState: {
          selfTyping: null,
          peerTyping: {
            updatedAt: "2026-04-07T12:00:58Z",
            expiresAt: "2026-04-07T12:01:04Z",
          },
        },
      },
    });

    expect(event).toEqual({
      type: "direct_chat.typing.updated",
      chatId: "chat-1",
      typingState: {
        selfTyping: null,
        peerTyping: {
          updatedAt: "2026-04-07T12:00:58Z",
          expiresAt: "2026-04-07T12:01:04Z",
        },
      },
    });
  });

  it("normalizes viewer-relative presence state payload", () => {
    const event = parseDirectChatRealtimeEvent({
      id: "evt-presence-1",
      type: "direct_chat.presence.updated",
      issuedAt: "2026-04-07T12:02:00Z",
      payload: {
        chatId: "chat-1",
        presenceState: {
          selfPresence: {
            heartbeatAt: "2026-04-07T12:01:59Z",
            expiresAt: "2026-04-07T12:02:29Z",
          },
          peerPresence: null,
        },
      },
    });

    expect(event).toEqual({
      type: "direct_chat.presence.updated",
      chatId: "chat-1",
      presenceState: {
        selfPresence: {
          heartbeatAt: "2026-04-07T12:01:59Z",
          expiresAt: "2026-04-07T12:02:29Z",
        },
        peerPresence: null,
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
