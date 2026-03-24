const storageKey = "aerochat.shell.runtime";

export interface ShellBootPreferences {
  chooserCompleted: boolean;
  rebootToBoot: boolean;
}

export interface ShellPreferencesStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const defaultShellBootPreferences: ShellBootPreferences = {
  chooserCompleted: false,
  rebootToBoot: false,
};

export function readShellBootPreferences(
  storage: ShellPreferencesStorageLike | null,
): ShellBootPreferences {
  if (storage === null) {
    return defaultShellBootPreferences;
  }

  try {
    const raw = storage.getItem(storageKey);
    if (raw === null || raw.trim() === "") {
      return defaultShellBootPreferences;
    }

    const parsed = JSON.parse(raw) as Partial<ShellBootPreferences>;
    return {
      chooserCompleted: parsed.chooserCompleted === true,
      rebootToBoot: parsed.rebootToBoot === true,
    };
  } catch {
    return defaultShellBootPreferences;
  }
}

export function writeShellBootPreferences(
  storage: ShellPreferencesStorageLike | null,
  preferences: ShellBootPreferences,
): void {
  if (storage === null) {
    return;
  }

  try {
    storage.setItem(storageKey, JSON.stringify(preferences));
  } catch {
    // Локальное хранилище не гарантировано в каждом окружении.
  }
}

export function getBrowserShellPreferencesStorage(): ShellPreferencesStorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
