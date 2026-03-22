import { afterEach, describe, expect, it } from "vitest";
import {
  clearBufferedLocalEncryptedDirectMessageV2Projection,
  discardBufferedLocalEncryptedDirectMessageV2Projection,
  listBufferedLocalEncryptedDirectMessageV2Projection,
  publishLocalEncryptedDirectMessageV2Projection,
} from "./encrypted-v2-local-outbound";

afterEach(() => {
  clearBufferedLocalEncryptedDirectMessageV2Projection();
});

describe("encrypted direct message v2 local outbound buffer", () => {
  it("drops optimistic entry after matching authoritative server-backed copy", () => {
    publishLocalEncryptedDirectMessageV2Projection({
      status: "ready",
      messageId: "message-1",
      chatId: "chat-1",
      senderUserId: "user-1",
      senderCryptoDeviceId: "crypto-1",
      operationKind: "content",
      targetMessageId: null,
      revision: 1,
      createdAt: "2026-03-22T12:00:00Z",
      storedAt: "2026-03-22T12:00:01Z",
      payloadSchema: "aerochat.web.encrypted_direct_message_v2.payload.v1",
      text: "hello",
      markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
      editedAt: null,
      deletedAt: null,
    });

    discardBufferedLocalEncryptedDirectMessageV2Projection([
      {
        chatId: "chat-1",
        messageId: "message-1",
        revision: 1,
      },
    ]);

    expect(listBufferedLocalEncryptedDirectMessageV2Projection("chat-1")).toEqual([]);
  });

  it("ignores late optimistic publish when authoritative copy was already observed", () => {
    discardBufferedLocalEncryptedDirectMessageV2Projection([
      {
        chatId: "chat-1",
        messageId: "message-2",
        revision: 1,
      },
    ]);

    publishLocalEncryptedDirectMessageV2Projection({
      status: "ready",
      messageId: "message-2",
      chatId: "chat-1",
      senderUserId: "user-1",
      senderCryptoDeviceId: "crypto-1",
      operationKind: "content",
      targetMessageId: null,
      revision: 1,
      createdAt: "2026-03-22T12:00:00Z",
      storedAt: "2026-03-22T12:00:01Z",
      payloadSchema: "aerochat.web.encrypted_direct_message_v2.payload.v1",
      text: "late optimistic",
      markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
      editedAt: null,
      deletedAt: null,
    });

    expect(listBufferedLocalEncryptedDirectMessageV2Projection("chat-1")).toEqual([]);
  });
});
