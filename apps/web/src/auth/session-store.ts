const storageKey = "aerochat.gateway.session";

export interface SessionStore {
  read(): string | null;
  write(token: string): void;
  clear(): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createSessionStore(storage: StorageLike | null): SessionStore {
  return {
    read() {
      if (storage === null) {
        return null;
      }

      try {
        const value = storage.getItem(storageKey);
        if (value === null || value.trim() === "") {
          return null;
        }

        return value;
      } catch {
        return null;
      }
    },

    write(token) {
      if (storage === null) {
        return;
      }

      try {
        storage.setItem(storageKey, token);
      } catch {
        storage.removeItem(storageKey);
      }
    },

    clear() {
      if (storage === null) {
        return;
      }

      try {
        storage.removeItem(storageKey);
      } catch {
        // sessionStorage может быть недоступен в строгих browser-политиках.
      }
    },
  };
}

export function createBrowserSessionStore(): SessionStore {
  if (typeof window === "undefined") {
    return createSessionStore(null);
  }

  try {
    return createSessionStore(window.sessionStorage);
  } catch {
    return createSessionStore(null);
  }
}
