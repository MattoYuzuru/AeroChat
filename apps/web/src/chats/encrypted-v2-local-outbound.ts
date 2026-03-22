import type { EncryptedDirectMessageV2DecryptedEnvelope } from "../crypto/types";

interface EncryptedDirectMessageV2LocalOutboundEvent {
  projection: EncryptedDirectMessageV2DecryptedEnvelope;
}

const buffered = new Map<string, EncryptedDirectMessageV2DecryptedEnvelope>();
const resolved = new Map<string, true>();
const listeners = new Set<
  (event: EncryptedDirectMessageV2LocalOutboundEvent) => void
>();
const resolvedProjectionKeyLimit = 200;

export function publishLocalEncryptedDirectMessageV2Projection(
  projection: EncryptedDirectMessageV2DecryptedEnvelope,
) {
  const key = buildProjectionKey(projection);
  if (resolved.has(key)) {
    return;
  }

  buffered.set(key, projection);

  const event = { projection } satisfies EncryptedDirectMessageV2LocalOutboundEvent;
  for (const listener of listeners) {
    listener(event);
  }
}

export function listBufferedLocalEncryptedDirectMessageV2Projection(
  chatId: string,
): EncryptedDirectMessageV2DecryptedEnvelope[] {
  return Array.from(buffered.values()).filter((entry) => entry.chatId === chatId);
}

export function subscribeLocalEncryptedDirectMessageV2Projection(
  listener: (event: EncryptedDirectMessageV2LocalOutboundEvent) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function discardBufferedLocalEncryptedDirectMessageV2Projection(
  values: Array<{
    chatId: string;
    messageId: string;
    revision: number;
  }>,
) {
  for (const value of values) {
    if (value.chatId.trim() === "" || value.messageId.trim() === "") {
      continue;
    }

    const key = buildProjectionKey(value);
    buffered.delete(key);
    resolved.set(key, true);
    trimResolvedProjectionKeys();
  }
}

export function clearBufferedLocalEncryptedDirectMessageV2Projection() {
  buffered.clear();
  resolved.clear();
}

function buildProjectionKey(value: {
  messageId: string;
  revision: number;
}): string {
  return [value.messageId, value.revision].join(":");
}

function trimResolvedProjectionKeys() {
  for (; resolved.size > resolvedProjectionKeyLimit; ) {
    const oldestKey = resolved.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }

    resolved.delete(oldestKey);
  }
}
