import type { RealtimeEnvelope } from "../realtime/client";

const encryptedDirectMessageV2DeliveryType = "encrypted_direct_message_v2.delivery";
const maxBufferedEncryptedDirectMessageV2Events = 64;

export interface EncryptedDirectMessageV2RealtimeEvent {
  type: "encrypted_direct_message_v2.delivery";
  envelope: {
    messageId: string;
    chatId: string;
    senderUserId: string;
    senderCryptoDeviceId: string;
    operationKind: string;
    targetMessageId: string | null;
    revision: number;
    createdAt: string;
    storedAt: string;
    viewerDelivery: {
      recipientCryptoDeviceId: string;
      transportHeader: string;
      ciphertext: string;
      ciphertextSizeBytes: number;
      storedAt: string;
    };
  };
}

type EncryptedDirectMessageV2RealtimeListener = (
  event: EncryptedDirectMessageV2RealtimeEvent,
) => void;

const encryptedListeners = new Set<EncryptedDirectMessageV2RealtimeListener>();
let bufferedEncryptedEvents: EncryptedDirectMessageV2RealtimeEvent[] = [];

export function parseEncryptedDirectMessageV2RealtimeEvent(
  envelope: RealtimeEnvelope,
): EncryptedDirectMessageV2RealtimeEvent | null {
  if (envelope.type !== encryptedDirectMessageV2DeliveryType) {
    return null;
  }

  const payload = envelope.payload;
  if (!isRecord(payload) || !isRecord(payload.envelope) || !isRecord(payload.envelope.viewerDelivery)) {
    return null;
  }

  const messageId = readRequiredString(payload.envelope.messageId);
  const chatId = readRequiredString(payload.envelope.chatId);
  const senderUserId = readRequiredString(payload.envelope.senderUserId);
  const senderCryptoDeviceId = readRequiredString(payload.envelope.senderCryptoDeviceId);
  const operationKind = readRequiredString(payload.envelope.operationKind);
  const createdAt = readRequiredString(payload.envelope.createdAt);
  const storedAt = readRequiredString(payload.envelope.storedAt);
  const recipientCryptoDeviceId = readRequiredString(
    payload.envelope.viewerDelivery.recipientCryptoDeviceId,
  );
  const viewerStoredAt = readRequiredString(payload.envelope.viewerDelivery.storedAt);
  const transportHeader = readString(payload.envelope.viewerDelivery.transportHeader);
  const ciphertext = readRequiredString(payload.envelope.viewerDelivery.ciphertext);
  const ciphertextSizeBytes = readRequiredNumber(payload.envelope.viewerDelivery.ciphertextSizeBytes);
  const revision = readRequiredNumber(payload.envelope.revision);
  if (
    messageId === null ||
    chatId === null ||
    senderUserId === null ||
    senderCryptoDeviceId === null ||
    operationKind === null ||
    createdAt === null ||
    storedAt === null ||
    recipientCryptoDeviceId === null ||
    viewerStoredAt === null ||
    transportHeader === null ||
    ciphertext === null ||
    ciphertextSizeBytes === null ||
    revision === null
  ) {
    return null;
  }

  return {
    type: "encrypted_direct_message_v2.delivery",
    envelope: {
      messageId,
      chatId,
      senderUserId,
      senderCryptoDeviceId,
      operationKind,
      targetMessageId: readOptionalString(payload.envelope.targetMessageId),
      revision,
      createdAt,
      storedAt,
      viewerDelivery: {
        recipientCryptoDeviceId,
        transportHeader,
        ciphertext,
        ciphertextSizeBytes,
        storedAt: viewerStoredAt,
      },
    },
  };
}

export function publishEncryptedDirectMessageV2RealtimeEvent(
  event: EncryptedDirectMessageV2RealtimeEvent,
) {
  bufferedEncryptedEvents = [event, ...bufferedEncryptedEvents].slice(
    0,
    maxBufferedEncryptedDirectMessageV2Events,
  );
  encryptedListeners.forEach((listener) => {
    listener(event);
  });
}

export function subscribeEncryptedDirectMessageV2RealtimeEvents(
  listener: EncryptedDirectMessageV2RealtimeListener,
) {
  encryptedListeners.add(listener);

  return () => {
    encryptedListeners.delete(listener);
  };
}

export function listBufferedEncryptedDirectMessageV2RealtimeEvents() {
  return bufferedEncryptedEvents.slice();
}

export function clearBufferedEncryptedDirectMessageV2RealtimeEvents() {
  bufferedEncryptedEvents = [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  return value;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  return value;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value;
}

function readRequiredNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}
