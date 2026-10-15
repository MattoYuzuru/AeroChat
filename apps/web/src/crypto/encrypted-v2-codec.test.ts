import { afterEach, describe, expect, it, vi } from "vitest";
import type { EncryptedDirectMessageV2Envelope } from "../gateway/types";
import { createWebCryptoMaterialFactory } from "./material";
import {
  decryptEncryptedDirectMessageV2Envelope,
  encryptEncryptedDirectMessageV2PayloadForTest,
  type EncryptedDirectMessageV2PayloadV1,
} from "./encrypted-v2-codec";
import {
  finalizeEncryptedMediaAttachmentDescriptorDraft,
  prepareEncryptedMediaRelayUpload,
} from "./encrypted-media-relay";

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
        replyToMessageId: null,
        message: {
          text: "local encrypted hello",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
          attachments: [],
        },
      },
    });

    const decrypted = await decryptEncryptedDirectMessageV2Envelope(material, {
      ...envelope,
      serverSequence: "9007199254740993",
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
      replyToMessageId: null,
      revision: 1,
      createdAt: "2026-03-22T12:00:00Z",
      serverSequence: "9007199254740993",
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
        replyToMessageId: null,
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

describe("encrypted direct timestamp AAD compatibility", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    ["2026-03-22T12:00:00.120Z", "2026-03-22T12:00:00.12Z"],
    ["2026-03-22T12:00:00.000Z", "2026-03-22T12:00:00Z"],
    ["2026-03-22T12:00:00.100Z", "2026-03-22T12:00:00.1Z"],
    ["2026-03-22T12:00:00.120Z", "2026-03-22T12:00:00.120000Z"],
    ["2026-03-22T12:00:00.000Z", "2026-03-22T12:00:00.000000000Z"],
  ])("authenticates historical %s after received %s, keeping source metadata", async (historical, received) => {
    const { material, envelope } = await createTimestampFixture(historical);
    const incoming = { ...envelope, createdAt: received };
    const before = structuredClone(incoming);
    const authentication = vi.spyOn(crypto.subtle, "decrypt");

    const result = await decryptEncryptedDirectMessageV2Envelope(material, incoming);

    expect(result).toMatchObject({ status: "ready", createdAt: received, text: "timestamp bound" });
    expect(incoming).toEqual(before);
    expect(authentication).toHaveBeenCalledTimes(2);
    expect(authentication.mock.calls.map(([params]) => decryptTimestamp(params))).toEqual([received, historical]);
    const [rawResult] = authentication.mock.results;
    if (rawResult === undefined) throw new Error("expected raw authentication");
    await expect(rawResult.value).rejects.toMatchObject({ name: "OperationError" });
  });

  it.each([
    "2026-03-22T12:00:00Z", "2026-03-22T12:00:00.120Z",
    "2026-03-22T12:00:00.120001Z", "2026-02-30T12:00:00Z",
  ])("preserves existing raw authentication for %s without candidate attempt", async (createdAt) => {
    const { material, envelope } = await createTimestampFixture(createdAt);
    const authentication = vi.spyOn(crypto.subtle, "decrypt");

    const result = await decryptEncryptedDirectMessageV2Envelope(material, envelope);

    expect(result).toMatchObject({ status: "ready", createdAt });
    expect(authentication).toHaveBeenCalledTimes(1);
    expect(authentication.mock.calls.map(([params]) => decryptTimestamp(params))).toEqual([createdAt]);
  });

  it.each([
    "2026-03-22T12:00:00.120001Z", "2026-02-30T12:00:00Z",
    "2026-03-22T12:00:00+00:00", "2026-03-22T12:00:00Z\n",
  ])("never repairs invalid or non-millisecond authenticated input %j", async (createdAt) => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const authentication = vi.spyOn(crypto.subtle, "decrypt");

    const result = await decryptEncryptedDirectMessageV2Envelope(material, { ...envelope, createdAt });

    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "aad_mismatch" });
    expect(authentication).toHaveBeenCalledTimes(1);
  });

  it.each([
    { messageId: "other-message" }, { chatId: "other-chat" },
    { senderUserId: "other-user" }, { senderCryptoDeviceId: "other-device" },
    { operationKind: "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_EDIT" },
    { targetMessageId: "other-target" }, { revision: 2 },
    { createdAt: "2026-03-22T12:00:00.13Z" },
  ])("keeps every authenticated context binding after compatibility %j", async (changed) => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const authentication = vi.spyOn(crypto.subtle, "decrypt");

    const result = await decryptEncryptedDirectMessageV2Envelope(material, {
      ...envelope, createdAt: "2026-03-22T12:00:00.12Z", ...changed,
    });

    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "aad_mismatch" });
    expect(authentication).toHaveBeenCalledTimes(2);
  });

  it("keeps recipient binding with the same private material and a different declared recipient", async () => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const result = await decryptEncryptedDirectMessageV2Envelope(
      { ...material, record: { ...material.record, cryptoDeviceId: "crypto-3" } },
      { ...envelope, createdAt: "2026-03-22T12:00:00.12Z", viewerDelivery: { ...envelope.viewerDelivery, recipientCryptoDeviceId: "crypto-3" } },
    );
    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "aad_mismatch" });
    expect(authentication).toHaveBeenCalledTimes(2);
  });

  it("rejects modified ciphertext after exactly two authentication attempts", async () => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const bytes = Uint8Array.from(atob(envelope.viewerDelivery.ciphertext), (byte) => byte.charCodeAt(0));
    const firstByte = bytes[0];
    if (firstByte === undefined) throw new Error("expected ciphertext bytes");
    bytes[0] = firstByte ^ 1;
    const result = await decryptEncryptedDirectMessageV2Envelope(material, {
      ...envelope, createdAt: "2026-03-22T12:00:00.12Z",
      viewerDelivery: { ...envelope.viewerDelivery, ciphertext: btoa(String.fromCharCode(...bytes)) },
    });
    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "aad_mismatch" });
    expect(authentication).toHaveBeenCalledTimes(2);
  });

  it.each(["recipient", "header", "schema", "operation"])("does not authenticate invalid %s preconditions", async (kind) => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const incoming = { ...envelope, createdAt: "2026-03-22T12:00:00.12Z", viewerDelivery: { ...envelope.viewerDelivery } };
    if (kind === "recipient") incoming.viewerDelivery.recipientCryptoDeviceId = "other-device";
    if (kind === "header") incoming.viewerDelivery.transportHeader = "invalid";
    if (kind === "schema") {
      const header = JSON.parse(atob(incoming.viewerDelivery.transportHeader));
      header.schema = "unsupported";
      incoming.viewerDelivery.transportHeader = btoa(JSON.stringify(header));
    }
    if (kind === "operation") incoming.operationKind = "unsupported";
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const result = await decryptEncryptedDirectMessageV2Envelope(material, incoming);
    expect(result.status).toBe("decrypt_failed");
    expect(authentication).not.toHaveBeenCalled();
  });

  it.each([
    ["schema", false], ["operation", false], ["descriptor", false],
    ["schema", true], ["operation", true], ["descriptor", true],
  ] as const)("does not retry invalid payload %s after authenticated compatibility=%s", async (kind, compatibility) => {
    const payload = timestampPayload();
    if (kind === "schema") Object.assign(payload, { schema: "unsupported" });
    if (kind === "operation") Object.assign(payload, { operation: "tombstone", deletedAt: "2026-03-22T12:00:00Z" });
    if (kind === "descriptor" && payload.operation === "content") Object.assign(payload.message, { attachments: [{}] });
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z", payload);
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const result = await decryptEncryptedDirectMessageV2Envelope(material, {
      ...envelope, createdAt: compatibility ? "2026-03-22T12:00:00.12Z" : envelope.createdAt,
    });
    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "invalid_payload" });
    expect(authentication).toHaveBeenCalledTimes(compatibility ? 2 : 1);
  });

  it("does not retry a non-authentication error", async () => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const authentication = vi.spyOn(crypto.subtle, "decrypt").mockRejectedValue(new DOMException("test", "InvalidAccessError"));
    const result = await decryptEncryptedDirectMessageV2Envelope(material, { ...envelope, createdAt: "2026-03-22T12:00:00.12Z" });
    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "decrypt_failed" });
    expect(authentication).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["2026-03-22T12:00:00.120Z", false], ["2026-03-22T12:00:00.120Z", true],
    ["2026-03-22T12:00:00.12Z", false], ["2026-03-22T12:00:00.12Z", true],
  ] as const)("emits a descriptor once for %s, callback OperationError=%s", async (received, throws) => {
    const upload = await prepareEncryptedMediaRelayUpload({ fileName: "fixture.bin", mimeType: "application/octet-stream", fileBytes: new Uint8Array([1, 2, 3]).buffer });
    const descriptor = finalizeEncryptedMediaAttachmentDescriptorDraft(upload.descriptor, "attachment-1");
    const payload = timestampPayload();
    if (payload.operation !== "content") throw new Error("expected content");
    payload.message.attachments = [descriptor];
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z", payload);
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const callback = vi.fn(() => { if (throws) throw new DOMException("test", "OperationError"); });

    const result = await decryptEncryptedDirectMessageV2Envelope(material, { ...envelope, createdAt: received }, { onEncryptedMediaDescriptor: callback });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(descriptor);
    expect(authentication).toHaveBeenCalledTimes(received === envelope.createdAt ? 1 : 2);
    expect(result).toMatchObject(throws ? { status: "decrypt_failed", failureKind: "aad_mismatch" } : { status: "ready", createdAt: received });
  });
});

function timestampPayload(): EncryptedDirectMessageV2PayloadV1 {
  return {
    schema: "aerochat.web.encrypted_direct_message_v2.payload.v1", operation: "content", replyToMessageId: null,
    message: { text: "timestamp bound", markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1", attachments: [] },
  };
}

async function createTimestampFixture(createdAt: string, payload = timestampPayload()) {
  const { material } = await createWebCryptoMaterialFactory().createDeviceMaterial({
    accountId: "user-2", login: "bob", deviceLabel: "Web Test", deviceId: "crypto-2", status: "active",
    bundleVersion: 1, publishedAt: null, linkIntentId: null, linkIntentExpiresAt: null,
  });
  const envelope = { ...createOpaqueEnvelope(), createdAt };
  const encrypted = await encryptEncryptedDirectMessageV2PayloadForTest({ recipientSignedPrekeyPublicKey: material.signedPrekeyPublicKey, envelope, payload });
  return { material, envelope: { ...envelope, viewerDelivery: { ...envelope.viewerDelivery, ...encrypted } } };
}

function decryptTimestamp(algorithm: AlgorithmIdentifier | RsaOaepParams | AesCtrParams | AesCbcParams | AesGcmParams): string {
  const params = algorithm as AesGcmParams;
  if (params.additionalData === undefined) throw new Error("expected authenticated metadata");
  return JSON.parse(new TextDecoder().decode(params.additionalData)).createdAt;
}

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
    serverSequence: "1",
    storedAt: "2026-03-22T12:00:01Z",
    viewerDelivery: {
      recipientUserId: "user-2",
      recipientCryptoDeviceId: "crypto-2",
      transportHeader: "",
      ciphertext: "",
      ciphertextSizeBytes: 0,
      storedAt: "2026-03-22T12:00:01Z",
      unreadState: null,
    },
  };
}
