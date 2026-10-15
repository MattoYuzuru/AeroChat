const maxServerSequence = 9223372036854775807n;

export function parseServerSequence(value: unknown, allowZero = false): string | null {
  if (typeof value !== "string" || value.length > 19 || !/^(0|[1-9]\d*)$/.test(value)) {
    return null;
  }
  const sequence = BigInt(value);
  if (sequence > maxServerSequence || (!allowZero && sequence === 0n)) {
    return null;
  }
  return value;
}

export function requireServerSequence(value: unknown, allowZero = false): string {
  const sequence = parseServerSequence(value, allowZero);
  if (sequence === null) {
    throw new Error("Не удалось подтвердить порядок сообщений. Обновите AeroChat и повторите попытку.");
  }
  return sequence;
}

export function compareServerSequences(left: string, right: string): number {
  const leftSequence = BigInt(requireServerSequence(left, true));
  const rightSequence = BigInt(requireServerSequence(right, true));
  return leftSequence < rightSequence ? -1 : leftSequence > rightSequence ? 1 : 0;
}

export function hasValidEncryptedReadSequences(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const state = value as Record<string, unknown>;
  return [state.selfPosition, state.peerPosition].every((position) => {
    if (position === undefined || position === null) {
      return true;
    }
    if (typeof position !== "object" || Array.isArray(position)) {
      return false;
    }
    const input = position as Record<string, unknown>;
    if ((input.messageId ?? "") === "" && (input.messageCreatedAt ?? "") === "" &&
      (input.updatedAt ?? "") === "" &&
      (input.lastReadServerSequence === undefined || input.lastReadServerSequence === "0")) {
      return true;
    }
    return typeof input.messageId === "string" && input.messageId.trim() !== "" &&
      parseServerSequence(input.lastReadServerSequence) !== null;
  });
}
