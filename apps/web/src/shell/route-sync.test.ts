import { describe, expect, it } from "vitest";
import { shouldSyncDesktopRouteToActiveWindow } from "./route-sync";

describe("desktop route sync", () => {
  it("does not bounce the route when the current explorer URL already points to the active singleton window", () => {
    expect(
      shouldSyncDesktopRouteToActiveWindow({
        activeWindowLaunchKey: "explorer",
        activeWindowRoutePath: "/app/explorer",
        currentPath: "/app/explorer?section=groups",
        routeLaunchKey: "explorer",
      }),
    ).toBe(false);
  });

  it("keeps syncing when focus changes to another route-backed window", () => {
    expect(
      shouldSyncDesktopRouteToActiveWindow({
        activeWindowLaunchKey: "search",
        activeWindowRoutePath: "/app/search",
        currentPath: "/app/explorer?section=groups",
        routeLaunchKey: "explorer",
      }),
    ).toBe(true);
  });
});
