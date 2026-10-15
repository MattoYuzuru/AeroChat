import { compareServerSequences, requireServerSequence } from "../gateway/server-sequence";
import type {
  EncryptedDirectMessageV2DecryptFailure,
  EncryptedDirectMessageV2DecryptedEnvelope,
  EncryptedMediaAttachmentDescriptor,
  EncryptedDirectMessageV2ReadyProjection,
} from "../crypto/types";

export const encryptedDirectMessageV2ProjectionLimit = 50;

export interface EncryptedDirectMessageV2ProjectedMessageEntry {
  kind: "message";
  key: string;
  messageId: string;
  chatId: string;
  senderUserId: string;
  senderCryptoDeviceId: string;
  revision: number;
  replyToMessageId: string | null;
  createdAt: string;
  serverSequence: string;
  lastAppliedServerSequence: string;
  lastEditServerSequence: string | null;
  tombstoneServerSequence: string | null;
  storedAt: string;
  text: string | null;
  markdownPolicy: string | null;
  attachments: EncryptedMediaAttachmentDescriptor[];
  editedAt: string | null;
  deletedAt: string | null;
  isTombstone: boolean;
}

export interface EncryptedDirectMessageV2ProjectionFailureEntry {
  kind: "failure";
  key: string;
  messageId: string;
  chatId: string;
  senderUserId: string;
  senderCryptoDeviceId: string;
  revision: number;
  createdAt: string;
  serverSequence: string;
  storedAt: string;
  failureKind:
    | EncryptedDirectMessageV2DecryptFailure["failureKind"]
    | "unresolved_target";
}

export type EncryptedDirectMessageV2ProjectionEntry =
  | EncryptedDirectMessageV2ProjectedMessageEntry
  | EncryptedDirectMessageV2ProjectionFailureEntry;

export function mergeEncryptedDirectMessageV2Projection(
  current: EncryptedDirectMessageV2ProjectionEntry[],
  updates: EncryptedDirectMessageV2DecryptedEnvelope[],
  limit = encryptedDirectMessageV2ProjectionLimit,
): EncryptedDirectMessageV2ProjectionEntry[] {
  const nextEntries = new Map<string, EncryptedDirectMessageV2ProjectionEntry>();
  for (const entry of current) {
    requireServerSequence(entry.serverSequence);
    if (entry.kind === "message") {
      requireServerSequence(entry.lastAppliedServerSequence);
      if (entry.lastEditServerSequence !== null) {
        requireServerSequence(entry.lastEditServerSequence);
      }
      if (entry.tombstoneServerSequence !== null) {
        requireServerSequence(entry.tombstoneServerSequence);
      }
    }
    nextEntries.set(entry.key, entry);
  }

  for (const update of [...updates].sort((left, right) =>
    compareServerSequences(left.serverSequence, right.serverSequence),
  )) {
    requireServerSequence(update.serverSequence);
    if (update.status === "decrypt_failed") {
      nextEntries.set(buildFailureKey(update.messageId, update.revision), {
        kind: "failure",
        key: buildFailureKey(update.messageId, update.revision),
        messageId: update.messageId,
        chatId: update.chatId,
        senderUserId: update.senderUserId,
        senderCryptoDeviceId: update.senderCryptoDeviceId,
        revision: update.revision,
        createdAt: update.createdAt,
        serverSequence: update.serverSequence,
        storedAt: update.storedAt,
        failureKind: update.failureKind,
      });
      continue;
    }

    if (applyReadyProjection(nextEntries, update)) {
      nextEntries.delete(buildFailureKey(update.messageId, update.revision));
    }
  }

  return Array.from(nextEntries.values())
    .sort(compareProjectionEntries)
    .slice(-limit);
}

export function describeEncryptedDirectMessageV2Failure(
  entry: EncryptedDirectMessageV2ProjectionFailureEntry,
): string {
  switch (entry.failureKind) {
    case "runtime_unavailable":
      return "Crypto runtime недоступен для локальной расшифровки этого envelope.";
    case "recipient_mismatch":
      return "Envelope пришёл не для текущего локального crypto-device.";
    case "invalid_transport_header":
      return "Transport header повреждён или не соответствует bootstrap codec этого slice.";
    case "unsupported_transport_schema":
      return "Transport schema этого encrypted envelope пока не поддерживается web local projection.";
    case "unsupported_operation_kind":
      return "Operation kind этого encrypted envelope пока не поддерживается local projection.";
    case "invalid_payload":
      return "Ciphertext расшифровался, но payload не прошёл валидацию bootstrap schema.";
    case "aad_mismatch":
      return "Не удалось подтвердить целостность encrypted envelope для текущего chat/device context.";
    case "decrypt_failed":
      return "Не удалось локально расшифровать encrypted envelope.";
    case "unresolved_target":
      return "Encrypted mutation не удалось локально применить, потому что target message не попал в текущее bounded окно.";
    default:
      return "Не удалось локально обработать encrypted envelope.";
  }
}

function applyReadyProjection(
  entries: Map<string, EncryptedDirectMessageV2ProjectionEntry>,
  update: EncryptedDirectMessageV2ReadyProjection,
): boolean {
  if (update.operationKind === "content") {
    const current = entries.get(buildMessageKey(update.messageId));
    if (current?.kind === "message" &&
      compareServerSequences(current.lastAppliedServerSequence, update.serverSequence) >= 0) {
      return true;
    }

    entries.set(buildMessageKey(update.messageId), {
      kind: "message",
      key: buildMessageKey(update.messageId),
      messageId: update.messageId,
      chatId: update.chatId,
      senderUserId: update.senderUserId,
      senderCryptoDeviceId: update.senderCryptoDeviceId,
      revision: update.revision,
      replyToMessageId: update.replyToMessageId,
      createdAt: update.createdAt,
      serverSequence: update.serverSequence,
      lastAppliedServerSequence: update.serverSequence,
      lastEditServerSequence: null,
      tombstoneServerSequence: null,
      storedAt: update.storedAt,
      text: update.text,
      markdownPolicy: update.markdownPolicy,
      attachments: update.attachments,
      editedAt: update.editedAt,
      deletedAt: update.deletedAt,
      isTombstone: false,
    });
    return true;
  }

  const targetMessageId = update.targetMessageId?.trim() ?? "";
  const targetKey = buildMessageKey(targetMessageId);
  const target = entries.get(targetKey);
  if (target === undefined || target.kind !== "message") {
    entries.set(buildFailureKey(update.messageId, update.revision), {
      kind: "failure",
      key: buildFailureKey(update.messageId, update.revision),
      messageId: update.messageId,
      chatId: update.chatId,
      senderUserId: update.senderUserId,
      senderCryptoDeviceId: update.senderCryptoDeviceId,
      revision: update.revision,
      createdAt: update.createdAt,
      serverSequence: update.serverSequence,
      storedAt: update.storedAt,
      failureKind: "unresolved_target",
    });
    return false;
  }

  const isLatestOperation = compareServerSequences(update.serverSequence, target.lastAppliedServerSequence) > 0;
  const next: EncryptedDirectMessageV2ProjectedMessageEntry = {
    ...target,
    lastAppliedServerSequence: isLatestOperation ? update.serverSequence : target.lastAppliedServerSequence,
    revision: isLatestOperation ? update.revision : target.revision,
    storedAt: maxTimestamp(target.storedAt, update.storedAt),
  };

  if (update.operationKind === "edit") {
    if (target.lastEditServerSequence === null ||
      compareServerSequences(update.serverSequence, target.lastEditServerSequence) > 0) {
      next.lastEditServerSequence = update.serverSequence;
      next.replyToMessageId = update.replyToMessageId;
      next.editedAt = update.editedAt ?? update.storedAt;
      if (!target.isTombstone) {
        next.text = update.text;
        next.markdownPolicy = update.markdownPolicy;
        next.attachments = update.attachments;
      }
    }
  } else {
    if (target.tombstoneServerSequence === null ||
      compareServerSequences(update.serverSequence, target.tombstoneServerSequence) > 0) {
      next.tombstoneServerSequence = update.serverSequence;
      next.deletedAt = update.deletedAt ?? update.storedAt;
    }
    next.text = null;
    next.markdownPolicy = null;
    next.attachments = [];
    next.isTombstone = true;
  }

  entries.set(targetKey, next);
  return true;
}

function compareProjectionEntries(
  left: EncryptedDirectMessageV2ProjectionEntry,
  right: EncryptedDirectMessageV2ProjectionEntry,
): number {
  return compareServerSequences(left.serverSequence, right.serverSequence) ||
    left.key.localeCompare(right.key);
}

function buildMessageKey(messageId: string): string {
  return `message:${messageId}`;
}

function buildFailureKey(messageId: string, revision: number): string {
  return `failure:${messageId}:${revision}`;
}

function maxTimestamp(left: string, right: string): string {
  return left >= right ? left : right;
}
