export interface LocalCallCaptureScope {
  kind: "direct" | "group";
  userId: string;
  authEpoch: symbol;
  scopeId: string;
  generation: number;
}

export interface LocalCallCaptureSnapshot {
  readonly kind: LocalCallCaptureScope["kind"];
  readonly phase: "capture_pending" | "retained" | "closing";
}

export interface LocalCallCaptureLease {
  readonly scope: Readonly<LocalCallCaptureScope>;
  isCurrent(): boolean;
  retain(): boolean;
  close(): void;
  release(): void;
  settle(): void;
}

export interface LocalCallCaptureOwner {
  acquire(scope: LocalCallCaptureScope):
    | { lease: LocalCallCaptureLease; message: null }
    | { lease: null; message: string };
  getSnapshot(): LocalCallCaptureSnapshot | null;
  subscribe(listener: () => void): () => void;
}

export function describeLocalCallCaptureConflict(snapshot: LocalCallCaptureSnapshot): string {
  return snapshot.phase === "closing"
    ? "Предыдущая попытка звонка ещё завершается. Дождитесь её окончания."
    : "В этом приложении уже выполняется другой звонок или его подключение. Сначала завершите его.";
}

// App-local call slot: заметки и authoritative backend media slot сюда не входят.
export function createLocalCallCaptureOwner(): LocalCallCaptureOwner {
  let owner: symbol | null = null;
  let snapshot: LocalCallCaptureSnapshot | null = null;
  const listeners = new Set<() => void>();
  const replaceSnapshot = (next: LocalCallCaptureSnapshot | null) => {
    snapshot = next === null ? null : Object.freeze(next);
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    acquire(scope) {
      if (snapshot !== null) {
        return { lease: null, message: describeLocalCallCaptureConflict(snapshot) };
      }
      if ((scope.kind !== "direct" && scope.kind !== "group") || typeof scope.authEpoch !== "symbol" ||
        scope.userId.trim() === "" || scope.scopeId.trim() === "" ||
        !Number.isSafeInteger(scope.generation) || scope.generation <= 0) {
        return { lease: null, message: "Не удалось определить локальную сессию звонка." };
      }

      const identity = Symbol();
      const leaseScope = Object.freeze({
        kind: scope.kind,
        userId: scope.userId,
        authEpoch: scope.authEpoch,
        scopeId: scope.scopeId,
        generation: scope.generation,
      });
      owner = identity;
      let pending = true;
      let releaseRequested = false;
      const isCurrent = () => owner === identity;
      const finishRelease = () => {
        if (!isCurrent() || pending || !releaseRequested) return;
        owner = null;
        replaceSnapshot(null);
      };
      replaceSnapshot({ kind: leaseScope.kind, phase: "capture_pending" });
      return {
        message: null,
        lease: {
          scope: leaseScope,
          isCurrent,
          retain() {
            if (!isCurrent() || snapshot?.phase === "closing") return false;
            if (snapshot?.phase !== "retained") {
              replaceSnapshot({ kind: leaseScope.kind, phase: "retained" });
            }
            return true;
          },
          close() {
            if (isCurrent() && snapshot?.phase !== "closing") {
              replaceSnapshot({ kind: leaseScope.kind, phase: "closing" });
            }
          },
          release() {
            if (!isCurrent()) return;
            releaseRequested = true;
            if (snapshot?.phase !== "closing") {
              replaceSnapshot({ kind: leaseScope.kind, phase: "closing" });
            }
            finishRelease();
          },
          settle() {
            if (!isCurrent()) return;
            pending = false;
            finishRelease();
          },
        },
      };
    },
  };
}
