import type {
  EncryptedDirectMessageV2DecryptFailure,
  EncryptedDirectMessageV2DecryptedEnvelope,
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
  createdAt: string;
  storedAt: string;
  text: string | null;
  markdownPolicy: string | null;
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
    nextEntries.set(entry.key, entry);
  }

  for (const update of updates) {
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
    if (current?.kind === "message" && current.revision > update.revision) {
      return false;
    }

    entries.set(buildMessageKey(update.messageId), {
      kind: "message",
      key: buildMessageKey(update.messageId),
      messageId: update.messageId,
      chatId: update.chatId,
      senderUserId: update.senderUserId,
      senderCryptoDeviceId: update.senderCryptoDeviceId,
      revision: update.revision,
      createdAt: update.createdAt,
      storedAt: update.storedAt,
      text: update.text,
      markdownPolicy: update.markdownPolicy,
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
      storedAt: update.storedAt,
      failureKind: "unresolved_target",
    });
    return false;
  }

  if (update.operationKind === "edit") {
    entries.set(targetKey, {
      ...target,
      revision: Math.max(target.revision, update.revision),
      storedAt: maxTimestamp(target.storedAt, update.storedAt),
      text: update.text,
      markdownPolicy: update.markdownPolicy,
      editedAt: update.editedAt ?? update.storedAt,
    });
    return true;
  }

  entries.set(targetKey, {
    ...target,
    revision: Math.max(target.revision, update.revision),
    storedAt: maxTimestamp(target.storedAt, update.storedAt),
    text: null,
    markdownPolicy: null,
    deletedAt: update.deletedAt ?? update.storedAt,
    isTombstone: true,
  });
  return true;
}

function compareProjectionEntries(
  left: EncryptedDirectMessageV2ProjectionEntry,
  right: EncryptedDirectMessageV2ProjectionEntry,
): number {
  if (left.createdAt === right.createdAt) {
    return left.key.localeCompare(right.key);
  }

  return left.createdAt.localeCompare(right.createdAt);
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
