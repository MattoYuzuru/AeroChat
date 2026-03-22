import { describe, expect, it } from "vitest";
import type { EncryptedGroupEnvelope } from "../gateway/types";
import { createWebCryptoMaterialFactory } from "./material";
import {
  decryptEncryptedGroupEnvelope,
  encryptEncryptedGroupPayloadForTest,
} from "./encrypted-group-codec";

describe("encrypted group codec", () => {
  it("decrypts bootstrap content payload for current local device", async () => {
    const factory = createWebCryptoMaterialFactory();
    const { material } = await factory.createDeviceMaterial({
      accountId: "user-2",
      login: "bob",
      deviceLabel: "Web Test",
      deviceId: "crypto-2",
      status: "active",
      bundleVersion: 1,
      publishedAt: null,
      linkIntentId: null,
      linkIntentExpiresAt: null,
    });
    const envelope = createOpaqueEnvelope();
    const encrypted = await encryptEncryptedGroupPayloadForTest({
      recipientDevices: [
        {
          cryptoDeviceId: "crypto-2",
          signedPrekeyPublicKey: material.signedPrekeyPublicKey,
        },
      ],
      envelope,
      payload: {
        schema: "aerochat.web.encrypted_group_message_v1.payload.v1",
        operation: "content",
        replyToMessageId: null,
        message: {
          text: "group local hello",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
          attachments: [],
        },
      },
    });

    const decrypted = await decryptEncryptedGroupEnvelope(material, {
      ...envelope,
      ...encrypted,
      viewerDelivery: {
        ...envelope.viewerDelivery,
      },
    });

    expect(decrypted).toEqual({
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
      replyToMessageId: null,
      revision: 1,
      createdAt: "2026-03-22T12:00:00Z",
      storedAt: "2026-03-22T12:00:01Z",
      payloadSchema: "aerochat.web.encrypted_group_message_v1.payload.v1",
      text: "group local hello",
      markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
      attachments: [],
      editedAt: null,
      deletedAt: null,
    });
  });

  it("fails decrypt when authenticated envelope metadata changes", async () => {
    const factory = createWebCryptoMaterialFactory();
    const { material } = await factory.createDeviceMaterial({
      accountId: "user-2",
      login: "bob",
      deviceLabel: "Web Test",
      deviceId: "crypto-2",
      status: "active",
      bundleVersion: 1,
      publishedAt: null,
      linkIntentId: null,
      linkIntentExpiresAt: null,
    });
    const envelope = createOpaqueEnvelope();
    const encrypted = await encryptEncryptedGroupPayloadForTest({
      recipientDevices: [
        {
          cryptoDeviceId: "crypto-2",
          signedPrekeyPublicKey: material.signedPrekeyPublicKey,
        },
      ],
      envelope,
      payload: {
        schema: "aerochat.web.encrypted_group_message_v1.payload.v1",
        operation: "content",
        replyToMessageId: null,
        message: {
          text: "bound payload",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
          attachments: [],
        },
      },
    });

    const decrypted = await decryptEncryptedGroupEnvelope(material, {
      ...envelope,
      rosterVersion: 8,
      ...encrypted,
      viewerDelivery: {
        ...envelope.viewerDelivery,
      },
    });

    expect(decrypted.status).toBe("decrypt_failed");
    if (decrypted.status !== "decrypt_failed") {
      throw new Error("expected decrypt failure");
    }
    expect(decrypted.failureKind).toBe("aad_mismatch");
  });
});

function createOpaqueEnvelope(): EncryptedGroupEnvelope {
  return {
    messageId: "message-1",
    groupId: "group-1",
    threadId: "thread-1",
    mlsGroupId: "mls-1",
    rosterVersion: 7,
    senderUserId: "user-1",
    senderCryptoDeviceId: "crypto-1",
    operationKind: "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT",
    targetMessageId: null,
    revision: 1,
    ciphertext: "",
    ciphertextSizeBytes: 0,
    createdAt: "2026-03-22T12:00:00Z",
    storedAt: "2026-03-22T12:00:01Z",
    viewerDelivery: {
      recipientUserId: "user-2",
      recipientCryptoDeviceId: "crypto-2",
      storedAt: "2026-03-22T12:00:01Z",
      unreadState: null,
    },
  };
}
