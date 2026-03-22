import { describe, expect, it } from "vitest";
import type { EncryptedDirectMessageV2Envelope } from "../gateway/types";
import { createWebCryptoMaterialFactory } from "./material";
import {
  decryptEncryptedDirectMessageV2Envelope,
  encryptEncryptedDirectMessageV2PayloadForTest,
} from "./encrypted-v2-codec";

describe("encrypted direct message v2 codec", () => {
  it("decrypts bootstrap content payload inside crypto boundary", async () => {
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
    const encrypted = await encryptEncryptedDirectMessageV2PayloadForTest({
      recipientSignedPrekeyPublicKey: material.signedPrekeyPublicKey,
      envelope,
      payload: {
        schema: "aerochat.web.encrypted_direct_message_v2.payload.v1",
        operation: "content",
        message: {
          text: "local encrypted hello",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
          attachments: [],
        },
      },
    });

    const decrypted = await decryptEncryptedDirectMessageV2Envelope(material, {
      ...envelope,
      viewerDelivery: {
        ...envelope.viewerDelivery,
        ...encrypted,
      },
    });

    expect(decrypted).toEqual({
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
      text: "local encrypted hello",
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
    const encrypted = await encryptEncryptedDirectMessageV2PayloadForTest({
      recipientSignedPrekeyPublicKey: material.signedPrekeyPublicKey,
      envelope,
      payload: {
        schema: "aerochat.web.encrypted_direct_message_v2.payload.v1",
        operation: "content",
        message: {
          text: "bound payload",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
          attachments: [],
        },
      },
    });

    const decrypted = await decryptEncryptedDirectMessageV2Envelope(material, {
      ...envelope,
      chatId: "chat-2",
      viewerDelivery: {
        ...envelope.viewerDelivery,
        ...encrypted,
      },
    });

    expect(decrypted.status).toBe("decrypt_failed");
    if (decrypted.status !== "decrypt_failed") {
      throw new Error("expected decrypt failure");
    }
    expect(decrypted.failureKind).toBe("aad_mismatch");
  });
});

function createOpaqueEnvelope(): EncryptedDirectMessageV2Envelope {
  return {
    messageId: "message-1",
    chatId: "chat-1",
    senderUserId: "user-1",
    senderCryptoDeviceId: "crypto-1",
    operationKind: "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT",
    targetMessageId: null,
    revision: 1,
    createdAt: "2026-03-22T12:00:00Z",
    storedAt: "2026-03-22T12:00:01Z",
    viewerDelivery: {
      recipientUserId: "user-2",
      recipientCryptoDeviceId: "crypto-2",
      transportHeader: "",
      ciphertext: "",
      ciphertextSizeBytes: 0,
      storedAt: "2026-03-22T12:00:01Z",
    },
  };
}
