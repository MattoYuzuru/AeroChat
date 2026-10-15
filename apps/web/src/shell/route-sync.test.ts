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
        previousLocationKey: "current",
        currentLocationKey: "current",
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
        previousLocationKey: "current",
        currentLocationKey: "current",
      }),
    ).toBe(true);
  });

  it("lets a new browser location select its target before reverse window sync", () => {
    expect(shouldSyncDesktopRouteToActiveWindow({
      activeWindowLaunchKey: "direct_chat:peer",
      activeWindowRoutePath: "/app/chats?chat=peer",
      currentPath: "/app/groups?group=group",
      routeLaunchKey: "group_chat:group",
      previousLocationKey: "old",
      currentLocationKey: "pop",
    })).toBe(false);
  });

  it("does not replace an initial deep link while its window launch is pending", () => {
    expect(shouldSyncDesktopRouteToActiveWindow({
      activeWindowLaunchKey: null,
      activeWindowRoutePath: "/app",
      currentPath: "/app/chats?chat=peer",
      routeLaunchKey: "direct_chat:peer",
      previousLocationKey: "initial",
      currentLocationKey: "initial",
    })).toBe(false);
  });

  it("lets focus-only selection of an existing window update the URL", () => {
    expect(shouldSyncDesktopRouteToActiveWindow({
      activeWindowLaunchKey: "direct_chat:peer",
      activeWindowRoutePath: "/app/chats?chat=peer",
      currentPath: "/app/groups?group=group",
      routeLaunchKey: "group_chat:group",
      previousLocationKey: "same",
      currentLocationKey: "same",
    })).toBe(true);
  });
});
