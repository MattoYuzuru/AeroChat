import { compareServerSequences, requireServerSequence } from "../gateway/server-sequence";

interface LaneEntry {
  kind: "message" | "failure";
  messageId: string;
  serverSequence: string;
  failureKind?: string;
}

interface LaneUpdate {
  status: string;
  messageId: string;
  serverSequence: string;
  operationKind: string;
  targetMessageId: string | null;
}

export function resolveEncryptedLanePageSize(pageSize: number): number {
  return Number.isFinite(pageSize) && pageSize >= 1 ? Math.trunc(pageSize) : 50;
}

export function mergeEncryptedLaneWithPending<Entry extends LaneEntry, Update extends LaneUpdate>(
  current: Entry[],
  pending: Update[],
  updates: Update[],
  pageSize: number,
  merge: (current: Entry[], updates: Update[], limit: number) => Entry[],
): { items: Entry[]; pendingMutations: Update[] } {
  const limit = resolveEncryptedLanePageSize(pageSize);
  const contentIds = new Set(updates.filter((update) =>
    update.status === "ready" && update.operationKind === "content",
  ).map((update) => update.messageId));
  const retry = pending.filter((update) =>
    update.targetMessageId !== null && contentIds.has(update.targetMessageId),
  );
  const items = merge(current, [...updates, ...retry], limit);
  const unresolved = new Set(items.filter((item) =>
    item.kind === "failure" && item.failureKind === "unresolved_target",
  ).map(operationIdentity));
  const candidates = new Map<string, Update>();
  for (const update of [...pending, ...updates]) {
    if (update.status !== "ready" ||
      (update.operationKind !== "edit" && update.operationKind !== "tombstone")) {
      continue;
    }
    const identity = operationIdentity(update);
    if (unresolved.has(identity)) {
      candidates.set(identity, update);
    }
  }

  // Payload ограничен памятью текущей lane; overflow не удаляет visible failure.
  return {
    items,
    pendingMutations: [...candidates.values()].sort((left, right) =>
      compareServerSequences(left.serverSequence, right.serverSequence),
    ).slice(-Math.min(limit, 64)),
  };
}

function operationIdentity(operation: { messageId: string; serverSequence: string }): string {
  return JSON.stringify([operation.messageId, requireServerSequence(operation.serverSequence)]);
}
