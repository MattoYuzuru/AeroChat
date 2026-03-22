import { afterEach, describe, expect, it } from "vitest";
import {
  clearBufferedEncryptedDirectMessageV2RealtimeEvents,
  listBufferedEncryptedDirectMessageV2RealtimeEvents,
  parseEncryptedDirectMessageV2RealtimeEvent,
  publishEncryptedDirectMessageV2RealtimeEvent,
} from "./encrypted-v2-realtime";

afterEach(() => {
  clearBufferedEncryptedDirectMessageV2RealtimeEvents();
});

describe("encrypted direct message v2 realtime helpers", () => {
  it("parses opaque encrypted delivery envelope", () => {
    const event = parseEncryptedDirectMessageV2RealtimeEvent({
      id: "evt-1",
      type: "encrypted_direct_message_v2.delivery",
      issuedAt: "2026-03-22T10:00:00Z",
      payload: {
        envelope: {
          messageId: "message-1",
          chatId: "chat-1",
          senderUserId: "user-1",
          senderCryptoDeviceId: "crypto-user-1",
          operationKind: "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT",
          targetMessageId: "",
          revision: 1,
          createdAt: "2026-03-22T10:00:00Z",
          storedAt: "2026-03-22T10:00:01Z",
          viewerDelivery: {
            recipientCryptoDeviceId: "crypto-user-2",
            transportHeader: "aGVhZGVy",
            ciphertext: "Y2lwaGVydGV4dA==",
            ciphertextSizeBytes: 10,
            storedAt: "2026-03-22T10:00:01Z",
            unreadState: {
              unreadCount: 3,
            },
          },
        },
      },
    });

    expect(event).toEqual({
      type: "encrypted_direct_message_v2.delivery",
      envelope: {
        messageId: "message-1",
        chatId: "chat-1",
        senderUserId: "user-1",
        senderCryptoDeviceId: "crypto-user-1",
        operationKind: "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT",
        targetMessageId: null,
        revision: 1,
        createdAt: "2026-03-22T10:00:00Z",
        storedAt: "2026-03-22T10:00:01Z",
        viewerDelivery: {
          recipientCryptoDeviceId: "crypto-user-2",
          transportHeader: "aGVhZGVy",
          ciphertext: "Y2lwaGVydGV4dA==",
          ciphertextSizeBytes: 10,
          storedAt: "2026-03-22T10:00:01Z",
          unreadState: {
            unreadCount: 3,
          },
        },
      },
    });
  });

  it("buffers latest opaque encrypted delivery events", () => {
    const first = parseEncryptedDirectMessageV2RealtimeEvent({
      id: "evt-1",
      type: "encrypted_direct_message_v2.delivery",
      issuedAt: "2026-03-22T10:00:00Z",
      payload: {
        envelope: {
          messageId: "message-1",
          chatId: "chat-1",
          senderUserId: "user-1",
          senderCryptoDeviceId: "crypto-user-1",
          operationKind: "CONTENT",
          revision: 1,
          createdAt: "2026-03-22T10:00:00Z",
          storedAt: "2026-03-22T10:00:01Z",
          viewerDelivery: {
            recipientCryptoDeviceId: "crypto-user-2",
            transportHeader: "header-1",
            ciphertext: "cipher-1",
            ciphertextSizeBytes: 8,
            storedAt: "2026-03-22T10:00:01Z",
          },
        },
      },
    });
    const second = parseEncryptedDirectMessageV2RealtimeEvent({
      id: "evt-2",
      type: "encrypted_direct_message_v2.delivery",
      issuedAt: "2026-03-22T10:00:02Z",
      payload: {
        envelope: {
          messageId: "message-2",
          chatId: "chat-1",
          senderUserId: "user-2",
          senderCryptoDeviceId: "crypto-user-2",
          operationKind: "CONTENT",
          revision: 1,
          createdAt: "2026-03-22T10:00:02Z",
          storedAt: "2026-03-22T10:00:03Z",
          viewerDelivery: {
            recipientCryptoDeviceId: "crypto-user-1",
            transportHeader: "header-2",
            ciphertext: "cipher-2",
            ciphertextSizeBytes: 8,
            storedAt: "2026-03-22T10:00:03Z",
          },
        },
      },
    });

    if (first === null || second === null) {
      throw new Error("expected encrypted realtime events to parse");
    }

    publishEncryptedDirectMessageV2RealtimeEvent(first);
    publishEncryptedDirectMessageV2RealtimeEvent(second);

    expect(listBufferedEncryptedDirectMessageV2RealtimeEvents()).toEqual([second, first]);
  });
});
