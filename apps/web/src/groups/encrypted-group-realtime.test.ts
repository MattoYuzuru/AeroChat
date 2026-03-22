import { describe, expect, it } from "vitest";
import { parseEncryptedGroupRealtimeEvent } from "./encrypted-group-realtime";

describe("parseEncryptedGroupRealtimeEvent", () => {
  it("normalizes encrypted group realtime payload", () => {
    const event = parseEncryptedGroupRealtimeEvent({
      id: "realtime-1",
      type: "encrypted_group_message_v1.delivery",
      issuedAt: "2026-03-22T12:00:01Z",
      payload: {
        envelope: {
          messageId: "message-1",
          groupId: "group-1",
          threadId: "thread-1",
          mlsGroupId: "mls-1",
          rosterVersion: 4,
          senderUserId: "user-1",
          senderCryptoDeviceId: "crypto-1",
          operationKind: "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT",
          targetMessageId: "",
          revision: 1,
          ciphertext: "Ym9keQ==",
          ciphertextSizeBytes: 4,
          createdAt: "2026-03-22T12:00:00Z",
          storedAt: "2026-03-22T12:00:01Z",
          viewerDelivery: {
            recipientUserId: "user-2",
            recipientCryptoDeviceId: "crypto-2",
            storedAt: "2026-03-22T12:00:01Z",
          },
        },
      },
    });

    expect(event).toEqual({
      type: "encrypted_group_message_v1.delivery",
      envelope: {
        messageId: "message-1",
        groupId: "group-1",
        threadId: "thread-1",
        mlsGroupId: "mls-1",
        rosterVersion: 4,
        senderUserId: "user-1",
        senderCryptoDeviceId: "crypto-1",
        operationKind: "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT",
        targetMessageId: null,
        revision: 1,
        ciphertext: "Ym9keQ==",
        ciphertextSizeBytes: 4,
        createdAt: "2026-03-22T12:00:00Z",
        storedAt: "2026-03-22T12:00:01Z",
        viewerDelivery: {
          recipientUserId: "user-2",
          recipientCryptoDeviceId: "crypto-2",
          storedAt: "2026-03-22T12:00:01Z",
        },
      },
    });
  });
});
