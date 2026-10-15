import { afterEach, describe, expect, it, vi } from "vitest";
import type { EncryptedGroupEnvelope } from "../gateway/types";
import { createWebCryptoMaterialFactory } from "./material";
import {
  decryptEncryptedGroupEnvelope,
  encryptEncryptedGroupPayloadForTest,
  type EncryptedGroupPayloadV1,
} from "./encrypted-group-codec";
import {
  finalizeEncryptedMediaAttachmentDescriptorDraft,
  prepareEncryptedMediaRelayUpload,
} from "./encrypted-media-relay";

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
      serverSequence: "9007199254740993",
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
      serverSequence: "9007199254740993",
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

  it("decrypts sender self-delivery after server round-trip operation kind normalization", async () => {
    const factory = createWebCryptoMaterialFactory();
    const { material } = await factory.createDeviceMaterial({
      accountId: "user-1",
      login: "alice",
      deviceLabel: "Web Test",
      deviceId: "crypto-1",
      status: "active",
      bundleVersion: 1,
      publishedAt: null,
      linkIntentId: null,
      linkIntentExpiresAt: null,
    });
    const encrypted = await encryptEncryptedGroupPayloadForTest({
      recipientDevices: [
        {
          cryptoDeviceId: "crypto-1",
          signedPrekeyPublicKey: material.signedPrekeyPublicKey,
        },
      ],
      envelope: {
        ...createOpaqueEnvelope(),
        senderUserId: "user-1",
        senderCryptoDeviceId: "crypto-1",
        operationKind: "content",
      },
      payload: {
        schema: "aerochat.web.encrypted_group_message_v1.payload.v1",
        operation: "content",
        replyToMessageId: null,
        message: {
          text: "self delivery",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
          attachments: [],
        },
      },
    });

    const decrypted = await decryptEncryptedGroupEnvelope(material, {
      ...createOpaqueEnvelope(),
      senderUserId: "user-1",
      senderCryptoDeviceId: "crypto-1",
      ...encrypted,
      viewerDelivery: {
        recipientUserId: "user-1",
        recipientCryptoDeviceId: "crypto-1",
        storedAt: "2026-03-22T12:00:01Z",
        unreadState: null,
      },
    });

    expect(decrypted).toEqual(
      expect.objectContaining({
        status: "ready",
        text: "self delivery",
        senderUserId: "user-1",
        senderCryptoDeviceId: "crypto-1",
        operationKind: "content",
      }),
    );
  });
});

describe("encrypted group timestamp AAD compatibility", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    ["2026-03-22T12:00:00.120Z", "2026-03-22T12:00:00.12Z"],
    ["2026-03-22T12:00:00.000Z", "2026-03-22T12:00:00Z"],
    ["2026-03-22T12:00:00.100Z", "2026-03-22T12:00:00.1Z"],
    ["2026-03-22T12:00:00.120Z", "2026-03-22T12:00:00.120000Z"],
    ["2026-03-22T12:00:00.000Z", "2026-03-22T12:00:00.000000000Z"],
  ])("authenticates both layers of historical %s after received %s", async (historical, received) => {
    const { material, envelope } = await createTimestampFixture(historical);
    const incoming = { ...envelope, createdAt: received };
    const before = structuredClone(incoming);
    const authentication = vi.spyOn(crypto.subtle, "decrypt");

    const result = await decryptEncryptedGroupEnvelope(material, incoming);

    expect(result).toMatchObject({ status: "ready", createdAt: received, text: "timestamp bound" });
    expect(incoming).toEqual(before);
    expect(authentication.mock.calls.map(([params]) => decryptAAD(params))).toEqual([
      { schema: wrapSchema, createdAt: received },
      { schema: wrapSchema, createdAt: historical },
      { schema: groupPayloadSchema, createdAt: historical },
    ]);
    const [rawResult] = authentication.mock.results;
    if (rawResult === undefined) throw new Error("expected raw authentication");
    await expect(rawResult.value).rejects.toMatchObject({ name: "OperationError" });
  });

  it.each([
    "2026-03-22T12:00:00Z", "2026-03-22T12:00:00.120Z",
    "2026-03-22T12:00:00.120001Z", "2026-02-30T12:00:00Z",
  ])("preserves raw authentication in both layers for %s without retry", async (createdAt) => {
    const { material, envelope } = await createTimestampFixture(createdAt);
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const result = await decryptEncryptedGroupEnvelope(material, envelope);
    expect(result).toMatchObject({ status: "ready", createdAt });
    expect(authentication.mock.calls.map(([params]) => decryptAAD(params))).toEqual([
      { schema: wrapSchema, createdAt }, { schema: groupPayloadSchema, createdAt },
    ]);
  });

  it.each([
    "2026-03-22T12:00:00.120001Z", "2026-02-30T12:00:00Z",
    "2026-03-22T12:00:00+00:00", "2026-03-22T12:00:00Z\n",
  ])("never repairs invalid or non-millisecond input %j", async (createdAt) => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const result = await decryptEncryptedGroupEnvelope(material, { ...envelope, createdAt });
    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "aad_mismatch" });
    expect(authentication).toHaveBeenCalledTimes(1);
  });

  it.each([
    { messageId: "other-message" }, { groupId: "other-group" }, { threadId: "other-thread" },
    { mlsGroupId: "other-mls" }, { rosterVersion: 8 }, { senderUserId: "other-user" },
    { senderCryptoDeviceId: "other-device" }, { operationKind: "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_EDIT" },
    { targetMessageId: "other-target" }, { revision: 2 }, { createdAt: "2026-03-22T12:00:00.13Z" },
  ])("keeps every authenticated group context binding %j", async (changed) => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const result = await decryptEncryptedGroupEnvelope(material, {
      ...envelope, createdAt: "2026-03-22T12:00:00.12Z", ...changed,
    });
    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "aad_mismatch" });
    expect(authentication).toHaveBeenCalledTimes(2);
    expect(authentication.mock.calls.map(([params]) => decryptAAD(params).schema)).toEqual([wrapSchema, wrapSchema]);
  });

  it.each([wrapSchema, groupPayloadSchema])("rejects mixed raw/candidate layers when only %s uses candidate", async (changedSchema) => {
    const received = "2026-03-22T12:00:00.12Z";
    const historical = "2026-03-22T12:00:00.120Z";
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    const encryption = vi.spyOn(crypto.subtle, "encrypt").mockImplementation((algorithm, key, bytes) => {
      const params = algorithm as AesGcmParams;
      if (params.additionalData === undefined) throw new Error("expected authenticated metadata");
      const aad = JSON.parse(new TextDecoder().decode(params.additionalData));
      if (aad.schema !== changedSchema) return encrypt(algorithm, key, bytes);
      aad.createdAt = historical;
      return encrypt({ ...params, additionalData: new TextEncoder().encode(JSON.stringify(aad)) }, key, bytes);
    });
    let fixture: Awaited<ReturnType<typeof createTimestampFixture>>;
    try {
      fixture = await createTimestampFixture(received);
    } finally {
      encryption.mockRestore();
    }
    const authentication = vi.spyOn(crypto.subtle, "decrypt");

    const result = await decryptEncryptedGroupEnvelope(fixture.material, fixture.envelope);

    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "aad_mismatch" });
    expect(authentication.mock.calls.map(([params]) => decryptAAD(params))).toEqual(
      changedSchema === groupPayloadSchema ? [
        { schema: wrapSchema, createdAt: received },
        { schema: groupPayloadSchema, createdAt: received },
        { schema: wrapSchema, createdAt: historical },
      ] : [
        { schema: wrapSchema, createdAt: received },
        { schema: wrapSchema, createdAt: historical },
        { schema: groupPayloadSchema, createdAt: historical },
      ],
    );
  });

  it.each(["wrappedContentKeyBase64", "payloadCiphertextBase64"])("rejects tampered %s with bounded fresh layer attempts", async (field) => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const transport = JSON.parse(atob(envelope.ciphertext));
    const target = field === "wrappedContentKeyBase64" ? transport.recipientKeyBoxes[0] : transport;
    const bytes = Uint8Array.from(atob(target[field]), (byte) => byte.charCodeAt(0));
    const firstByte = bytes[0];
    if (firstByte === undefined) throw new Error("expected ciphertext bytes");
    bytes[0] = firstByte ^ 1;
    target[field] = btoa(String.fromCharCode(...bytes));
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const result = await decryptEncryptedGroupEnvelope(material, {
      ...envelope, createdAt: "2026-03-22T12:00:00.12Z", ciphertext: btoa(JSON.stringify(transport)),
    });
    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "aad_mismatch" });
    expect(authentication).toHaveBeenCalledTimes(field === "wrappedContentKeyBase64" ? 2 : 3);
    expect(authentication.mock.calls.filter(([params]) => decryptAAD(params).schema === wrapSchema)).toHaveLength(2);
  });

  it("keeps recipient binding even with the same private material and relabeled key box", async () => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const transport = JSON.parse(atob(envelope.ciphertext));
    transport.recipientKeyBoxes[0].recipientCryptoDeviceId = "crypto-3";
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const result = await decryptEncryptedGroupEnvelope(
      { ...material, record: { ...material.record, cryptoDeviceId: "crypto-3" } },
      { ...envelope, createdAt: "2026-03-22T12:00:00.12Z", ciphertext: btoa(JSON.stringify(transport)), viewerDelivery: { ...envelope.viewerDelivery, recipientCryptoDeviceId: "crypto-3" } },
    );
    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "aad_mismatch" });
    expect(authentication).toHaveBeenCalledTimes(2);
  });

  it.each(["recipient", "transport", "schema", "operation", "key-box"])("does not authenticate invalid %s preconditions", async (kind) => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const incoming = { ...envelope, createdAt: "2026-03-22T12:00:00.12Z", viewerDelivery: { ...envelope.viewerDelivery } };
    if (kind === "recipient") incoming.viewerDelivery.recipientCryptoDeviceId = "other-device";
    if (kind === "transport") incoming.ciphertext = "invalid";
    if (kind === "operation") incoming.operationKind = "unsupported";
    if (kind === "schema" || kind === "key-box") {
      const transport = JSON.parse(atob(incoming.ciphertext));
      if (kind === "schema") transport.schema = "unsupported";
      else transport.recipientKeyBoxes = [];
      incoming.ciphertext = btoa(JSON.stringify(transport));
    }
    const authentication = vi.spyOn(crypto.subtle, "decrypt");
    const result = await decryptEncryptedGroupEnvelope(material, incoming);
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
    const result = await decryptEncryptedGroupEnvelope(material, {
      ...envelope, createdAt: compatibility ? "2026-03-22T12:00:00.12Z" : envelope.createdAt,
    });
    expect(result).toMatchObject({ status: "decrypt_failed", failureKind: "invalid_payload" });
    expect(authentication).toHaveBeenCalledTimes(compatibility ? 3 : 2);
  });

  it("does not retry a non-authentication error", async () => {
    const { material, envelope } = await createTimestampFixture("2026-03-22T12:00:00.120Z");
    const authentication = vi.spyOn(crypto.subtle, "decrypt").mockRejectedValue(new DOMException("test", "InvalidAccessError"));
    const result = await decryptEncryptedGroupEnvelope(material, { ...envelope, createdAt: "2026-03-22T12:00:00.12Z" });
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
    const result = await decryptEncryptedGroupEnvelope(material, { ...envelope, createdAt: received }, { onEncryptedMediaDescriptor: callback });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(descriptor);
    expect(authentication).toHaveBeenCalledTimes(received === envelope.createdAt ? 2 : 3);
    expect(result).toMatchObject(throws ? { status: "decrypt_failed", failureKind: "aad_mismatch" } : { status: "ready", createdAt: received });
  });
});

const wrapSchema = "aerochat.web.encrypted_group_message_v1.transport.v1";
const groupPayloadSchema = "aerochat.web.encrypted_group_message_v1.payload.v1";

function timestampPayload(): EncryptedGroupPayloadV1 {
  return { schema: groupPayloadSchema, operation: "content", replyToMessageId: null,
    message: { text: "timestamp bound", markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1", attachments: [] } };
}

async function createTimestampFixture(createdAt: string, payload = timestampPayload()) {
  const { material } = await createWebCryptoMaterialFactory().createDeviceMaterial({
    accountId: "user-2", login: "bob", deviceLabel: "Web Test", deviceId: "crypto-2", status: "active",
    bundleVersion: 1, publishedAt: null, linkIntentId: null, linkIntentExpiresAt: null,
  });
  const envelope = { ...createOpaqueEnvelope(), createdAt };
  const encrypted = await encryptEncryptedGroupPayloadForTest({
    recipientDevices: [{ cryptoDeviceId: "crypto-2", signedPrekeyPublicKey: material.signedPrekeyPublicKey }], envelope, payload,
  });
  return { material, envelope: { ...envelope, ...encrypted } };
}

function decryptAAD(algorithm: AlgorithmIdentifier | RsaOaepParams | AesCtrParams | AesCbcParams | AesGcmParams): { schema: string; createdAt: string } {
  const params = algorithm as AesGcmParams;
  if (params.additionalData === undefined) throw new Error("expected authenticated metadata");
  const aad = JSON.parse(new TextDecoder().decode(params.additionalData));
  return { schema: aad.schema, createdAt: aad.createdAt };
}

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
    serverSequence: "1",
    storedAt: "2026-03-22T12:00:01Z",
    viewerDelivery: {
      recipientUserId: "user-2",
      recipientCryptoDeviceId: "crypto-2",
      storedAt: "2026-03-22T12:00:01Z",
      unreadState: null,
    },
  };
}
