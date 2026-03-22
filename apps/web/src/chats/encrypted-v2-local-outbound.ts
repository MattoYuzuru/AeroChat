import type { EncryptedDirectMessageV2DecryptedEnvelope } from "../crypto/types";

interface EncryptedDirectMessageV2LocalOutboundEvent {
  projection: EncryptedDirectMessageV2DecryptedEnvelope;
}

const buffered = new Map<string, EncryptedDirectMessageV2DecryptedEnvelope>();
const listeners = new Set<
  (event: EncryptedDirectMessageV2LocalOutboundEvent) => void
>();

export function publishLocalEncryptedDirectMessageV2Projection(
  projection: EncryptedDirectMessageV2DecryptedEnvelope,
) {
  const key = buildProjectionKey(projection);
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

function buildProjectionKey(value: EncryptedDirectMessageV2DecryptedEnvelope): string {
  return [value.messageId, value.revision].join(":");
}
