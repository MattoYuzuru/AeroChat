import { describe, expect, it } from "vitest";
import { patchLiveEncryptedDirectChatActivity } from "./live-direct-activity";

describe("patchLiveEncryptedDirectChatActivity", () => {
  it("updates encrypted unread count and resorts direct chats by encrypted activity", () => {
    const chats = [
      {
        id: "chat-1",
        kind: "CHAT_KIND_DIRECT",
        participants: [],
        pinnedMessageIds: [],
        encryptedPinnedMessageIds: [],
        unreadCount: 0,
        encryptedUnreadCount: 0,
        createdAt: "2026-03-25T10:00:00Z",
        updatedAt: "2026-03-25T10:05:00Z",
      },
      {
        id: "chat-2",
        kind: "CHAT_KIND_DIRECT",
        participants: [],
        pinnedMessageIds: [],
        encryptedPinnedMessageIds: [],
        unreadCount: 0,
        encryptedUnreadCount: 1,
        createdAt: "2026-03-25T10:00:00Z",
        updatedAt: "2026-03-25T10:06:00Z",
      },
    ];

    const nextChats = patchLiveEncryptedDirectChatActivity(chats, {
      type: "encrypted_direct_message_v2.delivery",
      envelope: {
        messageId: "encrypted-1",
        chatId: "chat-1",
        senderUserId: "user-2",
        senderCryptoDeviceId: "crypto-2",
        operationKind: "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT",
        targetMessageId: null,
        revision: 1,
        createdAt: "2026-03-25T10:07:00Z",
        storedAt: "2026-03-25T10:07:01Z",
        viewerDelivery: {
          recipientCryptoDeviceId: "crypto-1",
          transportHeader: "header",
          ciphertext: "ciphertext",
          ciphertextSizeBytes: 10,
          storedAt: "2026-03-25T10:07:01Z",
          unreadState: {
            unreadCount: 4,
          },
        },
      },
    });

    expect(nextChats.map((chat) => chat.id)).toEqual(["chat-1", "chat-2"]);
    expect(nextChats[0]?.updatedAt).toBe("2026-03-25T10:07:01Z");
    expect(nextChats[0]?.encryptedUnreadCount).toBe(4);
    expect(nextChats[0]?.unreadCount).toBe(0);
  });

  it("ignores encrypted activity for unknown direct chats", () => {
    const chats = [
      {
        id: "chat-1",
        kind: "CHAT_KIND_DIRECT",
        participants: [],
        pinnedMessageIds: [],
        encryptedPinnedMessageIds: [],
        unreadCount: 0,
        encryptedUnreadCount: 0,
        createdAt: "2026-03-25T10:00:00Z",
        updatedAt: "2026-03-25T10:05:00Z",
      },
    ];

    expect(
      patchLiveEncryptedDirectChatActivity(chats, {
        type: "encrypted_direct_message_v2.delivery",
        envelope: {
          messageId: "encrypted-1",
          chatId: "chat-2",
          senderUserId: "user-2",
          senderCryptoDeviceId: "crypto-2",
          operationKind: "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT",
          targetMessageId: null,
          revision: 1,
          createdAt: "2026-03-25T10:07:00Z",
          storedAt: "2026-03-25T10:07:01Z",
          viewerDelivery: {
            recipientCryptoDeviceId: "crypto-1",
            transportHeader: "header",
            ciphertext: "ciphertext",
            ciphertextSizeBytes: 10,
            storedAt: "2026-03-25T10:07:01Z",
            unreadState: null,
          },
        },
      }),
    ).toEqual(chats);
  });
});
