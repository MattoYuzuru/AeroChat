export interface DirectCallJoinLease {
  release(): void;
  markUncertain(chatId: string, callId: string): void;
}

export interface DirectCallJoinCoordinator {
  acquire(userId: string, callId: string | null):
    | { lease: DirectCallJoinLease; message: null }
    | { lease: null; message: string };
  observationVersion(): number;
  describeUncertainCall(userId: string, callId: string | null): string | null;
  observeChat(chatId: string, activeCallId: string | null, version: number): void;
}

// Owner — app provider: lease переживает закрытие thread, но не хранит media runtime.
export function createDirectCallJoinCoordinator(): DirectCallJoinCoordinator {
  const pendingByUser = new Map<string, symbol>();
  const uncertainByUser = new Map<string, Map<string, string>>();
  let observationVersion = 0;
  const describeUncertainCall = (userId: string, callId: string | null) =>
    callId !== null && [...(uncertainByUser.get(userId)?.values() ?? [])].includes(callId)
      ? "Не удалось подтвердить выход из предыдущей попытки. Обновляем состояние звонка; повторите вход после его завершения."
      : null;

  return {
    acquire(userId, callId) {
      if (pendingByUser.has(userId)) {
        return { lease: null, message: "Предыдущая попытка звонка ещё завершается. Дождитесь её окончания и повторите." };
      }
      const uncertainMessage = describeUncertainCall(userId, callId);
      if (uncertainMessage !== null) {
        return { lease: null, message: uncertainMessage };
      }
      const owner = Symbol();
      pendingByUser.set(userId, owner);
      return {
        message: null,
        lease: {
          release() {
            if (pendingByUser.get(userId) === owner) pendingByUser.delete(userId);
          },
          markUncertain(chatId, callId) {
            if (pendingByUser.get(userId) !== owner) return;
            const calls = uncertainByUser.get(userId) ?? new Map<string, string>();
            calls.set(chatId, callId);
            uncertainByUser.set(userId, calls);
            observationVersion += 1;
            pendingByUser.delete(userId);
          },
        },
      };
    },
    observationVersion() { return observationVersion; },
    describeUncertainCall,
    observeChat(chatId, activeCallId, version) {
      if (version !== observationVersion) return;
      for (const [userId, calls] of uncertainByUser) {
        if (calls.has(chatId) && calls.get(chatId) !== activeCallId) calls.delete(chatId);
        if (calls.size === 0) uncertainByUser.delete(userId);
      }
    },
  };
}
