import type { EncryptedDirectMessageV2Envelope } from "../gateway/types";
import type {
  EncryptedDirectMessageV2DecryptFailure,
  EncryptedDirectMessageV2DecryptedEnvelope,
  EncryptedDirectMessageV2ReadyProjection,
  LocalCryptoDeviceMaterial,
} from "./types";

const transportSchema = "aerochat.web.encrypted_direct_message_v2.transport.v1";
const payloadSchema = "aerochat.web.encrypted_direct_message_v2.payload.v1";
const hkdfInfo = "aerochat.web.encrypted_direct_message_v2.bootstrap.v1";

interface EncryptedDirectMessageV2TransportHeaderV1 {
  schema: typeof transportSchema;
  ephemeralPublicKeyBase64: string;
  saltBase64: string;
  ivBase64: string;
}

export interface EncryptedDirectMessageV2OutboundEnvelopeMetadata {
  messageId: string;
  chatId: string;
  senderUserId: string;
  senderCryptoDeviceId: string;
  operationKind: "content" | "edit" | "tombstone";
  targetMessageId: string | null;
  revision: number;
  createdAt: string;
  recipientCryptoDeviceId: string;
}

interface EncryptedDirectMessageV2ContentPayloadV1 {
  schema: typeof payloadSchema;
  operation: "content";
  message: {
    kind: "text";
    text: string;
    markdownPolicy: string;
  };
}

interface EncryptedDirectMessageV2EditPayloadV1 {
  schema: typeof payloadSchema;
  operation: "edit";
  message: {
    kind: "text";
    text: string;
    markdownPolicy: string;
  };
  editedAt: string;
}

interface EncryptedDirectMessageV2TombstonePayloadV1 {
  schema: typeof payloadSchema;
  operation: "tombstone";
  deletedAt: string;
}

export type EncryptedDirectMessageV2PayloadV1 =
  | EncryptedDirectMessageV2ContentPayloadV1
  | EncryptedDirectMessageV2EditPayloadV1
  | EncryptedDirectMessageV2TombstonePayloadV1;

export async function decryptEncryptedDirectMessageV2Envelope(
  material: LocalCryptoDeviceMaterial,
  envelope: EncryptedDirectMessageV2Envelope,
): Promise<EncryptedDirectMessageV2DecryptedEnvelope> {
  if (
    material.record.cryptoDeviceId !== envelope.viewerDelivery.recipientCryptoDeviceId
  ) {
    return buildFailure(envelope, "recipient_mismatch");
  }

  const header = parseTransportHeader(envelope.viewerDelivery.transportHeader);
  if (header === null) {
    return buildFailure(envelope, "invalid_transport_header");
  }
  if (header.schema !== transportSchema) {
    return buildFailure(envelope, "unsupported_transport_schema");
  }

  const operationKind = normalizeOperationKind(envelope.operationKind);
  if (operationKind === null) {
    return buildFailure(envelope, "unsupported_operation_kind");
  }

  try {
    const plaintext = await decryptPayload(material, header, envelope);
    const payload = parsePayload(plaintext);
    if (payload === null || payload.operation !== operationKind) {
      return buildFailure(envelope, "invalid_payload");
    }

    return buildReadyProjection(envelope, operationKind, payload);
  } catch (error) {
    if (error instanceof DOMException && error.name === "OperationError") {
      return buildFailure(envelope, "aad_mismatch");
    }

    return buildFailure(envelope, "decrypt_failed");
  }
}

export async function encryptEncryptedDirectMessageV2Payload(input: {
  recipientSignedPrekeyPublicBase64: string;
  metadata: EncryptedDirectMessageV2OutboundEnvelopeMetadata;
  payload: EncryptedDirectMessageV2PayloadV1;
}): Promise<{
  transportHeader: string;
  ciphertext: string;
  ciphertextSizeBytes: number;
}> {
  const recipientSignedPrekeyPublicKey = await crypto.subtle.importKey(
    "spki",
    toArrayBuffer(fromBase64(input.recipientSignedPrekeyPublicBase64)),
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    false,
    [],
  );

  return encryptEncryptedDirectMessageV2PayloadWithImportedKey({
    recipientSignedPrekeyPublicKey,
    metadata: input.metadata,
    payload: input.payload,
  });
}

export async function encryptEncryptedDirectMessageV2PayloadForTest(input: {
  recipientSignedPrekeyPublicKey: CryptoKey;
  envelope: EncryptedDirectMessageV2Envelope;
  payload: EncryptedDirectMessageV2PayloadV1;
}): Promise<
  Pick<EncryptedDirectMessageV2Envelope["viewerDelivery"], "transportHeader" | "ciphertext">
> {
  const encrypted = await encryptEncryptedDirectMessageV2PayloadWithImportedKey({
    recipientSignedPrekeyPublicKey: input.recipientSignedPrekeyPublicKey,
    metadata: {
      messageId: input.envelope.messageId,
      chatId: input.envelope.chatId,
      senderUserId: input.envelope.senderUserId,
      senderCryptoDeviceId: input.envelope.senderCryptoDeviceId,
      operationKind: normalizeOperationKind(input.envelope.operationKind) ?? "content",
      targetMessageId: input.envelope.targetMessageId,
      revision: input.envelope.revision,
      createdAt: input.envelope.createdAt,
      recipientCryptoDeviceId: input.envelope.viewerDelivery.recipientCryptoDeviceId,
    },
    payload: input.payload,
  });

  return {
    transportHeader: encrypted.transportHeader,
    ciphertext: encrypted.ciphertext,
  };
}

async function encryptEncryptedDirectMessageV2PayloadWithImportedKey(input: {
  recipientSignedPrekeyPublicKey: CryptoKey;
  metadata: EncryptedDirectMessageV2OutboundEnvelopeMetadata;
  payload: EncryptedDirectMessageV2PayloadV1;
}): Promise<{
  transportHeader: string;
  ciphertext: string;
  ciphertextSizeBytes: number;
}> {
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveKey", "deriveBits"],
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
      public: input.recipientSignedPrekeyPublicKey,
    },
    ephemeralKeyPair.privateKey,
    256,
  );
  const contentKey = await deriveContentKey(new Uint8Array(sharedSecret), salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(input.payload));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: toArrayBuffer(
        buildAdditionalAuthenticatedDataFromMetadata(input.metadata),
      ),
    },
    contentKey,
    toArrayBuffer(plaintext),
  );

  return {
    transportHeader: toBase64(
      new TextEncoder().encode(
        JSON.stringify({
          schema: transportSchema,
          ephemeralPublicKeyBase64: toBase64(new Uint8Array(ephemeralPublicKey)),
          saltBase64: toBase64(salt),
          ivBase64: toBase64(iv),
        } satisfies EncryptedDirectMessageV2TransportHeaderV1),
      ),
    ),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    ciphertextSizeBytes: new Uint8Array(ciphertext).byteLength,
  };
}

async function decryptPayload(
  material: LocalCryptoDeviceMaterial,
  header: EncryptedDirectMessageV2TransportHeaderV1,
  envelope: EncryptedDirectMessageV2Envelope,
): Promise<string> {
  const ephemeralPublicKey = await crypto.subtle.importKey(
    "spki",
    toArrayBuffer(fromBase64(header.ephemeralPublicKeyBase64)),
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
  const contentKey = await deriveContentKey(
    new Uint8Array(sharedSecret),
    fromBase64(header.saltBase64),
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64(header.ivBase64)),
      additionalData: toArrayBuffer(buildAdditionalAuthenticatedData(envelope)),
    },
    contentKey,
    toArrayBuffer(fromBase64(envelope.viewerDelivery.ciphertext)),
  );

  return new TextDecoder().decode(plaintext);
}

async function deriveContentKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
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
      info: toArrayBuffer(new TextEncoder().encode(hkdfInfo)),
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["decrypt", "encrypt"],
  );
}

function parseTransportHeader(
  value: string,
): EncryptedDirectMessageV2TransportHeaderV1 | null {
  try {
    const raw = JSON.parse(
      new TextDecoder().decode(fromBase64(value)),
    ) as Partial<EncryptedDirectMessageV2TransportHeaderV1>;
    if (
      typeof raw.schema !== "string" ||
      typeof raw.ephemeralPublicKeyBase64 !== "string" ||
      typeof raw.saltBase64 !== "string" ||
      typeof raw.ivBase64 !== "string"
    ) {
      return null;
    }

    return {
      schema: raw.schema as EncryptedDirectMessageV2TransportHeaderV1["schema"],
      ephemeralPublicKeyBase64: raw.ephemeralPublicKeyBase64,
      saltBase64: raw.saltBase64,
      ivBase64: raw.ivBase64,
    };
  } catch {
    return null;
  }
}

function parsePayload(value: string): EncryptedDirectMessageV2PayloadV1 | null {
  try {
    const raw = JSON.parse(value) as Partial<EncryptedDirectMessageV2PayloadV1>;
    if (raw.schema !== payloadSchema || typeof raw.operation !== "string") {
      return null;
    }
    if (raw.operation === "content" || raw.operation === "edit") {
      if (
        !isRecord(raw.message) ||
        raw.message.kind !== "text" ||
        typeof raw.message.text !== "string" ||
        typeof raw.message.markdownPolicy !== "string"
      ) {
        return null;
      }
      if (raw.operation === "edit" && typeof raw.editedAt !== "string") {
        return null;
      }
    }
    if (raw.operation === "tombstone" && typeof raw.deletedAt !== "string") {
      return null;
    }

    return raw as EncryptedDirectMessageV2PayloadV1;
  } catch {
    return null;
  }
}

function buildReadyProjection(
  envelope: EncryptedDirectMessageV2Envelope,
  operationKind: EncryptedDirectMessageV2ReadyProjection["operationKind"],
  payload: EncryptedDirectMessageV2PayloadV1,
): EncryptedDirectMessageV2ReadyProjection {
  return {
    status: "ready",
    messageId: envelope.messageId,
    chatId: envelope.chatId,
    senderUserId: envelope.senderUserId,
    senderCryptoDeviceId: envelope.senderCryptoDeviceId,
    operationKind,
    targetMessageId: envelope.targetMessageId,
    revision: envelope.revision,
    createdAt: envelope.createdAt,
    storedAt: envelope.storedAt,
    payloadSchema,
    text:
      payload.operation === "content" || payload.operation === "edit"
        ? payload.message.text
        : null,
    markdownPolicy:
      payload.operation === "content" || payload.operation === "edit"
        ? payload.message.markdownPolicy
        : null,
    editedAt: payload.operation === "edit" ? payload.editedAt : null,
    deletedAt: payload.operation === "tombstone" ? payload.deletedAt : null,
  };
}

function buildFailure(
  envelope: EncryptedDirectMessageV2Envelope,
  failureKind: EncryptedDirectMessageV2DecryptFailure["failureKind"],
): EncryptedDirectMessageV2DecryptFailure {
  return {
    status: "decrypt_failed",
    messageId: envelope.messageId,
    chatId: envelope.chatId,
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

function normalizeOperationKind(
  value: string,
): EncryptedDirectMessageV2ReadyProjection["operationKind"] | null {
  switch (value) {
    case "content":
    case "CONTENT":
    case "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT":
      return "content";
    case "edit":
    case "EDIT":
    case "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_EDIT":
      return "edit";
    case "tombstone":
    case "TOMBSTONE":
    case "ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_TOMBSTONE":
      return "tombstone";
    default:
      return null;
  }
}

function buildAdditionalAuthenticatedData(
  envelope: EncryptedDirectMessageV2Envelope,
): Uint8Array {
  return buildAdditionalAuthenticatedDataFromMetadata({
    messageId: envelope.messageId,
    chatId: envelope.chatId,
    senderUserId: envelope.senderUserId,
    senderCryptoDeviceId: envelope.senderCryptoDeviceId,
    operationKind: normalizeOperationKind(envelope.operationKind) ?? "content",
    targetMessageId: envelope.targetMessageId,
    revision: envelope.revision,
    createdAt: envelope.createdAt,
    recipientCryptoDeviceId: envelope.viewerDelivery.recipientCryptoDeviceId,
  });
}

function buildAdditionalAuthenticatedDataFromMetadata(
  metadata: EncryptedDirectMessageV2OutboundEnvelopeMetadata,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      messageId: metadata.messageId,
      chatId: metadata.chatId,
      senderUserId: metadata.senderUserId,
      senderCryptoDeviceId: metadata.senderCryptoDeviceId,
      operationKind: metadata.operationKind,
      targetMessageId: metadata.targetMessageId,
      revision: metadata.revision,
      createdAt: metadata.createdAt,
      recipientCryptoDeviceId: metadata.recipientCryptoDeviceId,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
