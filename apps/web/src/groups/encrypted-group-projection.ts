import type {
  EncryptedGroupDecryptFailure,
  EncryptedGroupDecryptedEnvelope,
  EncryptedGroupReadyProjection,
} from "../crypto/types";

export const encryptedGroupProjectionLimit = 50;

export interface EncryptedGroupProjectedMessageEntry {
  kind: "message";
  key: string;
  messageId: string;
  groupId: string;
  threadId: string;
  mlsGroupId: string;
  rosterVersion: number;
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

export interface EncryptedGroupProjectionFailureEntry {
  kind: "failure";
  key: string;
  messageId: string;
  groupId: string;
  threadId: string;
  mlsGroupId: string;
  rosterVersion: number;
  senderUserId: string;
  senderCryptoDeviceId: string;
  revision: number;
  createdAt: string;
  storedAt: string;
  failureKind:
    | EncryptedGroupDecryptFailure["failureKind"]
    | "unresolved_target";
}

export type EncryptedGroupProjectionEntry =
  | EncryptedGroupProjectedMessageEntry
  | EncryptedGroupProjectionFailureEntry;

export function mergeEncryptedGroupProjection(
  current: EncryptedGroupProjectionEntry[],
  updates: EncryptedGroupDecryptedEnvelope[],
  limit = encryptedGroupProjectionLimit,
): EncryptedGroupProjectionEntry[] {
  const nextEntries = new Map<string, EncryptedGroupProjectionEntry>();
  for (const entry of current) {
    nextEntries.set(entry.key, entry);
  }

  for (const update of updates) {
    if (update.status === "decrypt_failed") {
      nextEntries.set(buildFailureKey(update.messageId, update.revision), {
        kind: "failure",
        key: buildFailureKey(update.messageId, update.revision),
        messageId: update.messageId,
        groupId: update.groupId,
        threadId: update.threadId,
        mlsGroupId: update.mlsGroupId,
        rosterVersion: update.rosterVersion,
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

export function describeEncryptedGroupFailure(
  entry: EncryptedGroupProjectionFailureEntry,
): string {
  switch (entry.failureKind) {
    case "runtime_unavailable":
      return "Crypto runtime недоступен для локальной расшифровки encrypted group envelope.";
    case "recipient_mismatch":
      return "Envelope пришёл не для текущего local crypto-device.";
    case "unsupported_transport_schema":
      return "Transport schema этого encrypted group envelope пока не поддерживается web local projection.";
    case "missing_recipient_key":
      return "Для текущего local crypto-device в group envelope нет key box для decrypt.";
    case "invalid_transport_header":
      return "Group transport envelope повреждён или не соответствует bootstrap codec этого slice.";
    case "invalid_payload":
      return "Ciphertext расшифровался, но payload не прошёл валидацию bootstrap schema.";
    case "aad_mismatch":
      return "Не удалось подтвердить целостность encrypted group envelope для текущего group/runtime context.";
    case "decrypt_failed":
      return "Не удалось локально расшифровать encrypted group envelope.";
    case "unresolved_target":
      return "Encrypted group mutation не удалось локально применить, потому что target message не попал в текущее bounded окно.";
    default:
      return "Не удалось локально обработать encrypted group envelope.";
  }
}

function applyReadyProjection(
  entries: Map<string, EncryptedGroupProjectionEntry>,
  update: EncryptedGroupReadyProjection,
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
      groupId: update.groupId,
      threadId: update.threadId,
      mlsGroupId: update.mlsGroupId,
      rosterVersion: update.rosterVersion,
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
      groupId: update.groupId,
      threadId: update.threadId,
      mlsGroupId: update.mlsGroupId,
      rosterVersion: update.rosterVersion,
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
  left: EncryptedGroupProjectionEntry,
  right: EncryptedGroupProjectionEntry,
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
