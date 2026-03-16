import { describe, expect, it } from "vitest";
import { createSessionStore, type StorageLike } from "./session-store";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe("createSessionStore", () => {
  it("writes and reads session token", () => {
    const store = createSessionStore(new MemoryStorage());

    store.write("token-1");

    expect(store.read()).toBe("token-1");
  });

  it("returns null for empty values and clears token", () => {
    const storage = new MemoryStorage();
    const store = createSessionStore(storage);

    storage.setItem("aerochat.gateway.session", "");
    expect(store.read()).toBeNull();

    store.write("token-1");
    store.clear();

    expect(store.read()).toBeNull();
  });
});
