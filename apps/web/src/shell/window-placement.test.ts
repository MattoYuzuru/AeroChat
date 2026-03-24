import { describe, expect, it } from "vitest";
import type { ShellPreferencesStorageLike } from "./preferences";
import {
  createStoredShellWindowPlacementRecord,
  defaultShellWindowPlacementStorageState,
  normalizeShellWindowBounds,
  planShellWindowPlacementForLaunch,
  readShellWindowPlacementStorageState,
  upsertShellWindowPlacementRecord,
  writeShellWindowPlacementStorageState,
} from "./window-placement";

class MemoryStorage implements ShellPreferencesStorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("window placement", () => {
  it("persists and loads per-target placement records", () => {
    const storage = new MemoryStorage();
    const nextState = upsertShellWindowPlacementRecord(
      defaultShellWindowPlacementStorageState,
      "direct_chat:chat-1",
      {
        bounds: {
          x: 64,
          y: 48,
          width: 920,
          height: 680,
        },
        restoredState: "maximized",
      },
    );

    writeShellWindowPlacementStorageState(storage, nextState);

    expect(readShellWindowPlacementStorageState(storage)).toEqual(nextState);
  });

  it("restores a stored target placement before using cascade", () => {
    const planned = planShellWindowPlacementForLaunch(
      {
        placements: {
          "direct_chat:chat-7": {
            bounds: {
              x: 88,
              y: 76,
              width: 900,
              height: 640,
            },
            restoredState: "maximized",
          },
        },
        nextCascadeIndex: 3,
      },
      "direct_chat:chat-7",
      {
        width: 1200,
        height: 760,
      },
    );

    expect(planned.placement).toEqual({
      bounds: {
        x: 88,
        y: 76,
        width: 900,
        height: 640,
      },
      restoredState: "maximized",
    });
    expect(planned.storageState.nextCascadeIndex).toBe(3);
  });

  it("creates a bounded stagger for new windows and wraps instead of spiraling", () => {
    const first = planShellWindowPlacementForLaunch(
      defaultShellWindowPlacementStorageState,
      "direct_chat:chat-1",
      {
        width: 1240,
        height: 820,
      },
    );
    const second = planShellWindowPlacementForLaunch(
      first.storageState,
      "direct_chat:chat-2",
      {
        width: 1240,
        height: 820,
      },
    );
    const wrapped = planShellWindowPlacementForLaunch(
      {
        placements: {},
        nextCascadeIndex: 99,
      },
      "direct_chat:chat-3",
      {
        width: 1240,
        height: 820,
      },
    );

    expect(second.placement.bounds.x).toBeGreaterThan(first.placement.bounds.x);
    expect(second.placement.bounds.y).toBeGreaterThan(first.placement.bounds.y);
    expect(wrapped.placement.bounds.x).toBeLessThanOrEqual(212);
    expect(wrapped.placement.bounds.y).toBeLessThanOrEqual(174);
  });

  it("clamps invalid or off-screen bounds into the visible viewport", () => {
    expect(
      normalizeShellWindowBounds(
        {
          x: 3000,
          y: -120,
          width: 1800,
          height: 1200,
        },
        {
          width: 980,
          height: 720,
        },
      ),
    ).toEqual({
      x: 0,
      y: 0,
      width: 980,
      height: 720,
    });
  });

  it("stores maximize state but degrades minimized windows to the last meaningful reopen state", () => {
    expect(
      createStoredShellWindowPlacementRecord(
        {
          bounds: {
            x: 44,
            y: 32,
            width: 840,
            height: 620,
          },
          state: "maximized",
        },
        {
          width: 1200,
          height: 780,
        },
      ),
    ).toEqual({
      bounds: {
        x: 44,
        y: 32,
        width: 840,
        height: 620,
      },
      restoredState: "maximized",
    });

    expect(
      createStoredShellWindowPlacementRecord(
        {
          bounds: {
            x: 44,
            y: 32,
            width: 840,
            height: 620,
          },
          state: "minimized",
        },
        {
          width: 1200,
          height: 780,
        },
      ).restoredState,
    ).toBe("open");
  });
});
