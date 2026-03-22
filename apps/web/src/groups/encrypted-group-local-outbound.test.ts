import { afterEach, describe, expect, it } from "vitest";
import {
  clearBufferedLocalEncryptedGroupProjection,
  discardBufferedLocalEncryptedGroupProjection,
  listBufferedLocalEncryptedGroupProjection,
  publishLocalEncryptedGroupProjection,
} from "./encrypted-group-local-outbound";

afterEach(() => {
  clearBufferedLocalEncryptedGroupProjection();
});

describe("encrypted group local outbound buffer", () => {
  it("drops optimistic entry after matching authoritative server-backed copy", () => {
    publishLocalEncryptedGroupProjection({
      status: "ready",
      messageId: "message-1",
      groupId: "group-1",
      threadId: "thread-1",
      mlsGroupId: "mls-1",
      rosterVersion: 7,
      senderUserId: "user-1",
      senderCryptoDeviceId: "crypto-1",
      operationKind: "content",
      targetMessageId: null,
      revision: 1,
      createdAt: "2026-03-22T12:00:00Z",
      storedAt: "2026-03-22T12:00:01Z",
      payloadSchema: "aerochat.web.encrypted_group_message_v1.payload.v1",
      text: "hello group",
      markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
      editedAt: null,
      deletedAt: null,
    });

    discardBufferedLocalEncryptedGroupProjection([
      {
        groupId: "group-1",
        messageId: "message-1",
        revision: 1,
      },
    ]);

    expect(listBufferedLocalEncryptedGroupProjection("group-1")).toEqual([]);
  });

  it("ignores late optimistic publish when authoritative copy was already observed", () => {
    discardBufferedLocalEncryptedGroupProjection([
      {
        groupId: "group-1",
        messageId: "message-2",
        revision: 1,
      },
    ]);

    publishLocalEncryptedGroupProjection({
      status: "ready",
      messageId: "message-2",
      groupId: "group-1",
      threadId: "thread-1",
      mlsGroupId: "mls-1",
      rosterVersion: 7,
      senderUserId: "user-1",
      senderCryptoDeviceId: "crypto-1",
      operationKind: "content",
      targetMessageId: null,
      revision: 1,
      createdAt: "2026-03-22T12:00:00Z",
      storedAt: "2026-03-22T12:00:01Z",
      payloadSchema: "aerochat.web.encrypted_group_message_v1.payload.v1",
      text: "late optimistic",
      markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
      editedAt: null,
      deletedAt: null,
    });

    expect(listBufferedLocalEncryptedGroupProjection("group-1")).toEqual([]);
  });
});
