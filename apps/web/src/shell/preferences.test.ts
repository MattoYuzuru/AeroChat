import { describe, expect, it } from "vitest";
import {
  defaultShellBootPreferences,
  readShellBootPreferences,
  writeShellBootPreferences,
  type ShellPreferencesStorageLike,
} from "./preferences";

class MemoryStorage implements ShellPreferencesStorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("shell boot preferences", () => {
  it("returns defaults when storage is empty", () => {
    expect(readShellBootPreferences(new MemoryStorage())).toEqual(
      defaultShellBootPreferences,
    );
  });

  it("persists chooser and reboot flags", () => {
    const storage = new MemoryStorage();

    writeShellBootPreferences(storage, {
      chooserCompleted: true,
      rebootToBoot: true,
    });

    expect(readShellBootPreferences(storage)).toEqual({
      chooserCompleted: true,
      rebootToBoot: true,
    });
  });
});
