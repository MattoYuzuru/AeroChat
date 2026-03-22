import type { EncryptedGroupEnvelope } from "../gateway/types";
import type {
  EncryptedGroupDecryptedEnvelope,
  EncryptedGroupDecryptFailure,
  EncryptedGroupReadyProjection,
  LocalCryptoDeviceMaterial,
} from "./types";

const transportSchema = "aerochat.web.encrypted_group_message_v1.transport.v1";
const payloadSchema = "aerochat.web.encrypted_group_message_v1.payload.v1";
const wrapHkdfInfo = "aerochat.web.encrypted_group_message_v1.wrap.v1";

interface EncryptedGroupRecipientKeyBoxV1 {
  recipientCryptoDeviceId: string;
  ephemeralPublicKeyBase64: string;
  saltBase64: string;
  ivBase64: string;
  wrappedContentKeyBase64: string;
}

interface EncryptedGroupTransportEnvelopeV1 {
  schema: typeof transportSchema;
  payloadCiphertextBase64: string;
  payloadIvBase64: string;
  recipientKeyBoxes: EncryptedGroupRecipientKeyBoxV1[];
}

interface EncryptedGroupContentPayloadV1 {
  schema: typeof payloadSchema;
  operation: "content";
  replyToMessageId: string | null;
  message: {
    text: string | null;
    markdownPolicy: string | null;
  };
}

interface EncryptedGroupEditPayloadV1 {
  schema: typeof payloadSchema;
  operation: "edit";
  replyToMessageId: string | null;
  message: {
    text: string | null;
    markdownPolicy: string | null;
  };
  editedAt: string;
}

interface EncryptedGroupTombstonePayloadV1 {
  schema: typeof payloadSchema;
  operation: "tombstone";
  deletedAt: string;
}

export type EncryptedGroupPayloadV1 =
  | EncryptedGroupContentPayloadV1
  | EncryptedGroupEditPayloadV1
  | EncryptedGroupTombstonePayloadV1;

export interface EncryptedGroupOutboundEnvelopeMetadata {
  messageId: string;
  groupId: string;
  threadId: string;
  mlsGroupId: string;
  rosterVersion: number;
  senderUserId: string;
  senderCryptoDeviceId: string;
  operationKind: "content" | "control" | "edit" | "tombstone";
  targetMessageId: string | null;
  revision: number;
  createdAt: string;
}

export async function decryptEncryptedGroupEnvelope(
  material: LocalCryptoDeviceMaterial,
  envelope: EncryptedGroupEnvelope,
): Promise<EncryptedGroupDecryptedEnvelope> {
  if (
    material.record.cryptoDeviceId !== envelope.viewerDelivery.recipientCryptoDeviceId
  ) {
    return buildFailure(envelope, "recipient_mismatch");
  }

  const transport = parseTransportEnvelope(envelope.ciphertext);
  if (transport === null) {
    return buildFailure(envelope, "invalid_transport_header");
  }
  if (transport.schema !== transportSchema) {
    return buildFailure(envelope, "unsupported_transport_schema");
  }

  const operationKind = normalizeEnvelopeOperationKind(envelope.operationKind);
  if (operationKind === null) {
    return buildFailure(envelope, "invalid_payload");
  }

  const keyBox = transport.recipientKeyBoxes.find(
    (candidate) =>
      candidate.recipientCryptoDeviceId === envelope.viewerDelivery.recipientCryptoDeviceId,
  );
  if (keyBox === undefined) {
    return buildFailure(envelope, "missing_recipient_key");
  }

  try {
    const contentKey = await unwrapContentKey(material, envelope, keyBox);
    const plaintext = await decryptPayload(contentKey, envelope, transport);
    const payload = parsePayload(plaintext);
    if (payload === null) {
      return buildFailure(envelope, "invalid_payload");
    }

    if (operationKind === "control") {
      if (payload.operation !== "edit" && payload.operation !== "tombstone") {
        return buildFailure(envelope, "invalid_payload");
      }
    } else if (payload.operation !== operationKind) {
      return buildFailure(envelope, "invalid_payload");
    }

    return buildReadyProjection(envelope, payload);
  } catch (error) {
    if (error instanceof DOMException && error.name === "OperationError") {
      return buildFailure(envelope, "aad_mismatch");
    }

    return buildFailure(envelope, "decrypt_failed");
  }
}

export async function encryptEncryptedGroupPayload(input: {
  recipientDevices: Array<{
    cryptoDeviceId: string;
    signedPrekeyPublicBase64: string;
  }>;
  metadata: EncryptedGroupOutboundEnvelopeMetadata;
  payload: EncryptedGroupPayloadV1;
}): Promise<Pick<EncryptedGroupEnvelope, "ciphertext" | "ciphertextSizeBytes">> {
  const recipientDevices = await Promise.all(
    input.recipientDevices.map(async (recipientDevice) => ({
      cryptoDeviceId: recipientDevice.cryptoDeviceId,
      signedPrekeyPublicKey: await crypto.subtle.importKey(
        "spki",
        toArrayBuffer(fromBase64(recipientDevice.signedPrekeyPublicBase64)),
        {
          name: "ECDH",
          namedCurve: "P-256",
        },
        false,
        [],
      ),
    })),
  );

  return encryptEncryptedGroupPayloadWithImportedKeys({
    recipientDevices,
    envelope: input.metadata,
    payload: input.payload,
  });
}

export async function encryptEncryptedGroupPayloadForTest(input: {
  recipientDevices: Array<{
    cryptoDeviceId: string;
    signedPrekeyPublicKey: CryptoKey;
  }>;
  envelope: Pick<
    EncryptedGroupEnvelope,
    | "messageId"
    | "groupId"
    | "threadId"
    | "mlsGroupId"
    | "rosterVersion"
    | "senderUserId"
    | "senderCryptoDeviceId"
    | "operationKind"
    | "targetMessageId"
    | "revision"
    | "createdAt"
  >;
  payload: EncryptedGroupPayloadV1;
}): Promise<Pick<EncryptedGroupEnvelope, "ciphertext" | "ciphertextSizeBytes">> {
  return encryptEncryptedGroupPayloadWithImportedKeys(input);
}

async function encryptEncryptedGroupPayloadWithImportedKeys(input: {
  recipientDevices: Array<{
    cryptoDeviceId: string;
    signedPrekeyPublicKey: CryptoKey;
  }>;
  envelope: Pick<
    EncryptedGroupEnvelope,
    | "messageId"
    | "groupId"
    | "threadId"
    | "mlsGroupId"
    | "rosterVersion"
    | "senderUserId"
    | "senderCryptoDeviceId"
    | "operationKind"
    | "targetMessageId"
    | "revision"
    | "createdAt"
  >;
  payload: EncryptedGroupPayloadV1;
}): Promise<Pick<EncryptedGroupEnvelope, "ciphertext" | "ciphertextSizeBytes">> {
  const contentKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const contentKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(contentKeyBytes),
    {
      name: "AES-GCM",
    },
    false,
    ["encrypt"],
  );
  const payloadIv = crypto.getRandomValues(new Uint8Array(12));
  const payloadPlaintext = new TextEncoder().encode(JSON.stringify(input.payload));
  const payloadCiphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: payloadIv,
      additionalData: toArrayBuffer(buildPayloadAAD(input.envelope)),
    },
    contentKey,
    toArrayBuffer(payloadPlaintext),
  );
  const recipientKeyBoxes = await Promise.all(
    input.recipientDevices.map(async (recipientDevice) => {
      const ephemeralKeyPair = await crypto.subtle.generateKey(
        {
          name: "ECDH",
          namedCurve: "P-256",
        },
        true,
        ["deriveBits", "deriveKey"],
      );
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ephemeralPublicKey = await crypto.subtle.exportKey(
        "spki",
        ephemeralKeyPair.publicKey,
      );
      const sharedSecret = await crypto.subtle.deriveBits(
        {
          name: "ECDH",
          public: recipientDevice.signedPrekeyPublicKey,
        },
        ephemeralKeyPair.privateKey,
        256,
      );
      const wrapKey = await deriveWrapKey(new Uint8Array(sharedSecret), salt);
      const wrappedContentKey = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: toArrayBuffer(
            buildWrapAAD(input.envelope, recipientDevice.cryptoDeviceId),
          ),
        },
        wrapKey,
        toArrayBuffer(contentKeyBytes),
      );

      return {
        recipientCryptoDeviceId: recipientDevice.cryptoDeviceId,
        ephemeralPublicKeyBase64: toBase64(new Uint8Array(ephemeralPublicKey)),
        saltBase64: toBase64(salt),
        ivBase64: toBase64(iv),
        wrappedContentKeyBase64: toBase64(new Uint8Array(wrappedContentKey)),
      } satisfies EncryptedGroupRecipientKeyBoxV1;
    }),
  );

  const transport = new TextEncoder().encode(
    JSON.stringify({
      schema: transportSchema,
      payloadCiphertextBase64: toBase64(new Uint8Array(payloadCiphertext)),
      payloadIvBase64: toBase64(payloadIv),
      recipientKeyBoxes,
    } satisfies EncryptedGroupTransportEnvelopeV1),
  );

  return {
    ciphertext: toBase64(transport),
    ciphertextSizeBytes: transport.byteLength,
  };
}

async function unwrapContentKey(
  material: LocalCryptoDeviceMaterial,
  envelope: EncryptedGroupEnvelope,
  keyBox: EncryptedGroupRecipientKeyBoxV1,
): Promise<CryptoKey> {
  const ephemeralPublicKey = await crypto.subtle.importKey(
    "spki",
    toArrayBuffer(fromBase64(keyBox.ephemeralPublicKeyBase64)),
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: ephemeralPublicKey,
    },
    material.signedPrekeyPrivateKey,
    256,
  );
  const wrapKey = await deriveWrapKey(
    new Uint8Array(sharedSecret),
    fromBase64(keyBox.saltBase64),
  );
  const rawContentKey = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64(keyBox.ivBase64)),
      additionalData: toArrayBuffer(
        buildWrapAAD(envelope, keyBox.recipientCryptoDeviceId),
      ),
    },
    wrapKey,
    toArrayBuffer(fromBase64(keyBox.wrappedContentKeyBase64)),
  );

  return crypto.subtle.importKey(
    "raw",
    rawContentKey,
    {
      name: "AES-GCM",
    },
    false,
    ["decrypt"],
  );
}

async function decryptPayload(
  contentKey: CryptoKey,
  envelope: EncryptedGroupEnvelope,
  transport: EncryptedGroupTransportEnvelopeV1,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64(transport.payloadIvBase64)),
      additionalData: toArrayBuffer(buildPayloadAAD(envelope)),
    },
    contentKey,
    toArrayBuffer(fromBase64(transport.payloadCiphertextBase64)),
  );

  return new TextDecoder().decode(plaintext);
}

async function deriveWrapKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(sharedSecret),
    "HKDF",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(new TextEncoder().encode(wrapHkdfInfo)),
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

function parseTransportEnvelope(
  ciphertext: string,
): EncryptedGroupTransportEnvelopeV1 | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64(ciphertext)));
    if (!isRecord(parsed) || !Array.isArray(parsed.recipientKeyBoxes)) {
      return null;
    }
    if (
      typeof parsed.schema !== "string" ||
      typeof parsed.payloadCiphertextBase64 !== "string" ||
      typeof parsed.payloadIvBase64 !== "string"
    ) {
      return null;
    }

    return {
      schema: parsed.schema as typeof transportSchema,
      payloadCiphertextBase64: parsed.payloadCiphertextBase64,
      payloadIvBase64: parsed.payloadIvBase64,
      recipientKeyBoxes: parsed.recipientKeyBoxes.filter(isRecipientKeyBox),
    } satisfies EncryptedGroupTransportEnvelopeV1;
  } catch {
    return null;
  }
}

function parsePayload(plaintext: string): EncryptedGroupPayloadV1 | null {
  try {
    const parsed = JSON.parse(plaintext);
    if (!isRecord(parsed) || parsed.schema !== payloadSchema) {
      return null;
    }

    if (parsed.operation === "content" || parsed.operation === "edit") {
      if (!isRecord(parsed.message)) {
        return null;
      }
      const replyToMessageId =
        parsed.replyToMessageId === null || typeof parsed.replyToMessageId === "string"
          ? normalizeNullableMessageID(parsed.replyToMessageId)
          : undefined;
      const text = normalizeNullableString(parsed.message.text);
      const markdownPolicy = normalizeNullableString(parsed.message.markdownPolicy);
      if (replyToMessageId === undefined) {
        return null;
      }
      if (parsed.operation === "content") {
        return {
          schema: payloadSchema,
          operation: "content",
          replyToMessageId,
          message: {
            text,
            markdownPolicy,
          },
        };
      }
      if (typeof parsed.editedAt !== "string" || parsed.editedAt.trim() === "") {
        return null;
      }
      return {
        schema: payloadSchema,
        operation: "edit",
        replyToMessageId,
        message: {
          text,
          markdownPolicy,
        },
        editedAt: parsed.editedAt,
      };
    }

    if (
      parsed.operation === "tombstone" &&
      typeof parsed.deletedAt === "string" &&
      parsed.deletedAt.trim() !== ""
    ) {
      return {
        schema: payloadSchema,
        operation: "tombstone",
        deletedAt: parsed.deletedAt,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function buildReadyProjection(
  envelope: EncryptedGroupEnvelope,
  payload: EncryptedGroupPayloadV1,
): EncryptedGroupReadyProjection {
  return {
    status: "ready",
    messageId: envelope.messageId,
    groupId: envelope.groupId,
    threadId: envelope.threadId,
    mlsGroupId: envelope.mlsGroupId,
    rosterVersion: envelope.rosterVersion,
    senderUserId: envelope.senderUserId,
    senderCryptoDeviceId: envelope.senderCryptoDeviceId,
    operationKind: payload.operation,
    targetMessageId: envelope.targetMessageId,
    replyToMessageId:
      payload.operation === "content" || payload.operation === "edit"
        ? payload.replyToMessageId
        : null,
    revision: envelope.revision,
    createdAt: envelope.createdAt,
    storedAt: envelope.storedAt,
    payloadSchema,
    text: payload.operation === "tombstone" ? null : payload.message.text,
    markdownPolicy:
      payload.operation === "tombstone" ? null : payload.message.markdownPolicy,
    editedAt: payload.operation === "edit" ? payload.editedAt : null,
    deletedAt: payload.operation === "tombstone" ? payload.deletedAt : null,
  };
}

function buildFailure(
  envelope: EncryptedGroupEnvelope,
  failureKind: EncryptedGroupDecryptFailure["failureKind"],
): EncryptedGroupDecryptFailure {
  return {
    status: "decrypt_failed",
    messageId: envelope.messageId,
    groupId: envelope.groupId,
    threadId: envelope.threadId,
    mlsGroupId: envelope.mlsGroupId,
    rosterVersion: envelope.rosterVersion,
    senderUserId: envelope.senderUserId,
    senderCryptoDeviceId: envelope.senderCryptoDeviceId,
    operationKind: envelope.operationKind,
    targetMessageId: envelope.targetMessageId,
    revision: envelope.revision,
    createdAt: envelope.createdAt,
    storedAt: envelope.storedAt,
    failureKind,
  };
}

function buildWrapAAD(
  envelope: Pick<
    EncryptedGroupEnvelope,
    | "messageId"
    | "groupId"
    | "threadId"
    | "mlsGroupId"
    | "rosterVersion"
    | "senderUserId"
    | "senderCryptoDeviceId"
    | "operationKind"
    | "targetMessageId"
    | "revision"
    | "createdAt"
  >,
  recipientCryptoDeviceId: string,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schema: transportSchema,
      messageId: envelope.messageId,
      groupId: envelope.groupId,
      threadId: envelope.threadId,
      mlsGroupId: envelope.mlsGroupId,
      rosterVersion: envelope.rosterVersion,
      senderUserId: envelope.senderUserId,
      senderCryptoDeviceId: envelope.senderCryptoDeviceId,
      operationKind: envelope.operationKind,
      targetMessageId: envelope.targetMessageId,
      revision: envelope.revision,
      createdAt: envelope.createdAt,
      recipientCryptoDeviceId,
    }),
  );
}

function buildPayloadAAD(
  envelope: Pick<
    EncryptedGroupEnvelope,
    | "messageId"
    | "groupId"
    | "threadId"
    | "mlsGroupId"
    | "rosterVersion"
    | "senderUserId"
    | "senderCryptoDeviceId"
    | "operationKind"
    | "targetMessageId"
    | "revision"
    | "createdAt"
  >,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      schema: payloadSchema,
      messageId: envelope.messageId,
      groupId: envelope.groupId,
      threadId: envelope.threadId,
      mlsGroupId: envelope.mlsGroupId,
      rosterVersion: envelope.rosterVersion,
      senderUserId: envelope.senderUserId,
      senderCryptoDeviceId: envelope.senderCryptoDeviceId,
      operationKind: envelope.operationKind,
      targetMessageId: envelope.targetMessageId,
      revision: envelope.revision,
      createdAt: envelope.createdAt,
    }),
  );
}

function normalizeEnvelopeOperationKind(
  operationKind: string,
): "content" | "control" | "edit" | "tombstone" | null {
  switch (operationKind) {
    case "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT":
      return "content";
    case "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTROL":
      return "control";
    case "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_EDIT":
      return "edit";
    case "ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_TOMBSTONE":
      return "tombstone";
    default:
      return null;
  }
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeNullableMessageID(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRecipientKeyBox(value: unknown): value is EncryptedGroupRecipientKeyBoxV1 {
  return (
    isRecord(value) &&
    typeof value.recipientCryptoDeviceId === "string" &&
    typeof value.ephemeralPublicKeyBase64 === "string" &&
    typeof value.saltBase64 === "string" &&
    typeof value.ivBase64 === "string" &&
    typeof value.wrappedContentKeyBase64 === "string"
  );
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}
