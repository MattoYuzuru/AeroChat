import type { EncryptedGroupDecryptedEnvelope } from "../crypto/types";

interface EncryptedGroupLocalOutboundEvent {
  projection: EncryptedGroupDecryptedEnvelope;
}

const buffered = new Map<string, EncryptedGroupDecryptedEnvelope>();
const resolved = new Map<string, true>();
const listeners = new Set<(event: EncryptedGroupLocalOutboundEvent) => void>();
const resolvedProjectionKeyLimit = 200;

export function publishLocalEncryptedGroupProjection(
  projection: EncryptedGroupDecryptedEnvelope,
) {
  const key = buildProjectionKey(projection);
  if (resolved.has(key)) {
    return;
  }

  buffered.set(key, projection);

  const event = { projection } satisfies EncryptedGroupLocalOutboundEvent;
  for (const listener of listeners) {
    listener(event);
  }
}

export function listBufferedLocalEncryptedGroupProjection(
  groupId: string,
): EncryptedGroupDecryptedEnvelope[] {
  return Array.from(buffered.values()).filter((entry) => entry.groupId === groupId);
}

export function subscribeLocalEncryptedGroupProjection(
  listener: (event: EncryptedGroupLocalOutboundEvent) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function discardBufferedLocalEncryptedGroupProjection(
  values: Array<{
    groupId: string;
    messageId: string;
    revision: number;
  }>,
) {
  for (const value of values) {
    if (value.groupId.trim() === "" || value.messageId.trim() === "") {
      continue;
    }

    const key = buildProjectionKey(value);
    buffered.delete(key);
    resolved.set(key, true);
    trimResolvedProjectionKeys();
  }
}

export function clearBufferedLocalEncryptedGroupProjection() {
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
