import { describe, expect, it } from "vitest";
import { mergeEncryptedGroupProjection } from "./encrypted-group-projection";

describe("mergeEncryptedGroupProjection", () => {
  it("applies content, edit and tombstone into bounded local lane", () => {
    const projection = mergeEncryptedGroupProjection([], [
      {
        status: "ready",
        messageId: "message-1",
        groupId: "group-1",
        threadId: "thread-1",
        mlsGroupId: "mls-1",
        rosterVersion: 3,
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
      },
      {
        status: "ready",
        messageId: "message-2",
        groupId: "group-1",
        threadId: "thread-1",
        mlsGroupId: "mls-1",
        rosterVersion: 3,
        senderUserId: "user-1",
        senderCryptoDeviceId: "crypto-1",
        operationKind: "edit",
        targetMessageId: "message-1",
        revision: 2,
        createdAt: "2026-03-22T12:01:00Z",
        storedAt: "2026-03-22T12:01:01Z",
        payloadSchema: "aerochat.web.encrypted_group_message_v1.payload.v1",
        text: "hello edited",
        markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
        editedAt: "2026-03-22T12:01:00Z",
        deletedAt: null,
      },
      {
        status: "ready",
        messageId: "message-3",
        groupId: "group-1",
        threadId: "thread-1",
        mlsGroupId: "mls-1",
        rosterVersion: 3,
        senderUserId: "user-1",
        senderCryptoDeviceId: "crypto-1",
        operationKind: "tombstone",
        targetMessageId: "message-1",
        revision: 3,
        createdAt: "2026-03-22T12:02:00Z",
        storedAt: "2026-03-22T12:02:01Z",
        payloadSchema: "aerochat.web.encrypted_group_message_v1.payload.v1",
        text: null,
        markdownPolicy: null,
        editedAt: null,
        deletedAt: "2026-03-22T12:02:00Z",
      },
    ]);

    expect(projection).toEqual([
      {
        kind: "message",
        key: "message:message-1",
        messageId: "message-1",
        groupId: "group-1",
        threadId: "thread-1",
        mlsGroupId: "mls-1",
        rosterVersion: 3,
        senderUserId: "user-1",
        senderCryptoDeviceId: "crypto-1",
        revision: 3,
        createdAt: "2026-03-22T12:00:00Z",
        storedAt: "2026-03-22T12:02:01Z",
        text: null,
        markdownPolicy: null,
        editedAt: "2026-03-22T12:01:00Z",
        deletedAt: "2026-03-22T12:02:00Z",
        isTombstone: true,
      },
    ]);
  });

  it("keeps explicit failure entry when mutation target is missing", () => {
    const projection = mergeEncryptedGroupProjection([], [
      {
        status: "ready",
        messageId: "message-2",
        groupId: "group-1",
        threadId: "thread-1",
        mlsGroupId: "mls-1",
        rosterVersion: 3,
        senderUserId: "user-1",
        senderCryptoDeviceId: "crypto-1",
        operationKind: "edit",
        targetMessageId: "missing-message",
        revision: 2,
        createdAt: "2026-03-22T12:01:00Z",
        storedAt: "2026-03-22T12:01:01Z",
        payloadSchema: "aerochat.web.encrypted_group_message_v1.payload.v1",
        text: "hello edited",
        markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
        editedAt: "2026-03-22T12:01:00Z",
        deletedAt: null,
      },
    ]);

    expect(projection).toEqual([
      {
        kind: "failure",
        key: "failure:message-2:2",
        messageId: "message-2",
        groupId: "group-1",
        threadId: "thread-1",
        mlsGroupId: "mls-1",
        rosterVersion: 3,
        senderUserId: "user-1",
        senderCryptoDeviceId: "crypto-1",
        revision: 2,
        createdAt: "2026-03-22T12:01:00Z",
        storedAt: "2026-03-22T12:01:01Z",
        failureKind: "unresolved_target",
      },
    ]);
  });
});
