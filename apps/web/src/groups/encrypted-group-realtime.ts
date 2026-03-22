import type { RealtimeEnvelope } from "../realtime/client";

const encryptedGroupMessageDeliveryType = "encrypted_group_message_v1.delivery";
const maxBufferedEncryptedGroupEvents = 64;

export interface EncryptedGroupRealtimeEvent {
  type: "encrypted_group_message_v1.delivery";
  envelope: {
    messageId: string;
    groupId: string;
    threadId: string;
    mlsGroupId: string;
    rosterVersion: number;
    senderUserId: string;
    senderCryptoDeviceId: string;
    operationKind: string;
    targetMessageId: string | null;
    revision: number;
    ciphertext: string;
    ciphertextSizeBytes: number;
    createdAt: string;
    storedAt: string;
    viewerDelivery: {
      recipientUserId: string;
      recipientCryptoDeviceId: string;
      storedAt: string;
    };
  };
}

type EncryptedGroupRealtimeListener = (event: EncryptedGroupRealtimeEvent) => void;

const listeners = new Set<EncryptedGroupRealtimeListener>();
let bufferedEvents: EncryptedGroupRealtimeEvent[] = [];

export function parseEncryptedGroupRealtimeEvent(
  envelope: RealtimeEnvelope,
): EncryptedGroupRealtimeEvent | null {
  if (envelope.type !== encryptedGroupMessageDeliveryType) {
    return null;
  }

  const payload = envelope.payload;
  if (!isRecord(payload) || !isRecord(payload.envelope) || !isRecord(payload.envelope.viewerDelivery)) {
    return null;
  }

  const messageId = readRequiredString(payload.envelope.messageId);
  const groupId = readRequiredString(payload.envelope.groupId);
  const threadId = readRequiredString(payload.envelope.threadId);
  const mlsGroupId = readRequiredString(payload.envelope.mlsGroupId);
  const senderUserId = readRequiredString(payload.envelope.senderUserId);
  const senderCryptoDeviceId = readRequiredString(payload.envelope.senderCryptoDeviceId);
  const operationKind = readRequiredString(payload.envelope.operationKind);
  const createdAt = readRequiredString(payload.envelope.createdAt);
  const storedAt = readRequiredString(payload.envelope.storedAt);
  const recipientUserId = readRequiredString(payload.envelope.viewerDelivery.recipientUserId);
  const recipientCryptoDeviceId = readRequiredString(
    payload.envelope.viewerDelivery.recipientCryptoDeviceId,
  );
  const viewerStoredAt = readRequiredString(payload.envelope.viewerDelivery.storedAt);
  const ciphertext = readRequiredString(payload.envelope.ciphertext);
  const ciphertextSizeBytes = readRequiredNumber(payload.envelope.ciphertextSizeBytes);
  const revision = readRequiredNumber(payload.envelope.revision);
  const rosterVersion = readRequiredNumber(payload.envelope.rosterVersion);
  if (
    messageId === null ||
    groupId === null ||
    threadId === null ||
    mlsGroupId === null ||
    senderUserId === null ||
    senderCryptoDeviceId === null ||
    operationKind === null ||
    createdAt === null ||
    storedAt === null ||
    recipientUserId === null ||
    recipientCryptoDeviceId === null ||
    viewerStoredAt === null ||
    ciphertext === null ||
    ciphertextSizeBytes === null ||
    revision === null ||
    rosterVersion === null
  ) {
    return null;
  }

  return {
    type: "encrypted_group_message_v1.delivery",
    envelope: {
      messageId,
      groupId,
      threadId,
      mlsGroupId,
      rosterVersion,
      senderUserId,
      senderCryptoDeviceId,
      operationKind,
      targetMessageId: readOptionalString(payload.envelope.targetMessageId),
      revision,
      ciphertext,
      ciphertextSizeBytes,
      createdAt,
      storedAt,
      viewerDelivery: {
        recipientUserId,
        recipientCryptoDeviceId,
        storedAt: viewerStoredAt,
      },
    },
  };
}

export function publishEncryptedGroupRealtimeEvent(event: EncryptedGroupRealtimeEvent) {
  bufferedEvents = [event, ...bufferedEvents].slice(0, maxBufferedEncryptedGroupEvents);
  listeners.forEach((listener) => {
    listener(event);
  });
}

export function subscribeEncryptedGroupRealtimeEvents(
  listener: EncryptedGroupRealtimeListener,
) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function listBufferedEncryptedGroupRealtimeEvents() {
  return bufferedEvents.slice();
}

export function clearBufferedEncryptedGroupRealtimeEvents() {
  bufferedEvents = [];
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

function readRequiredNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}
