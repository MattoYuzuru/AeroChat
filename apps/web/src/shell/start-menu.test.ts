import { describe, expect, it } from "vitest";
import type { ShellPreferencesStorageLike } from "./preferences";
import {
  createInitialStartMenuPanelState,
  extractSearchParamsFromRoutePath,
  MAX_START_MENU_RECENT_ITEMS,
  readStartMenuRecentItems,
  resolveStartMenuRecentItemRoutePath,
  startMenuPanelReducer,
  trackStartMenuRecentWindow,
  writeStartMenuRecentItems,
} from "./start-menu";

class MemoryStorage implements ShellPreferencesStorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("start menu panel reducer", () => {
  it("toggles and closes start panel explicitly", () => {
    let state = createInitialStartMenuPanelState();

    state = startMenuPanelReducer(state, { type: "toggle" });
    expect(state.isOpen).toBe(true);

    state = startMenuPanelReducer(state, { type: "close" });
    expect(state.isOpen).toBe(false);

    state = startMenuPanelReducer(state, { type: "open" });
    expect(state.isOpen).toBe(true);
  });
});

describe("start menu recent items", () => {
  it("tracks direct chats by canonical target and promotes the latest focus to the front", () => {
    let items = trackStartMenuRecentWindow([], {
      appId: "direct_chat",
      title: "Алиса",
      routePath: "/app/chats?chat=chat-1",
      target: {
        key: "chat-1",
      },
    });

    items = trackStartMenuRecentWindow(items, {
      appId: "group_chat",
      title: "Design",
      routePath: "/app/groups?group=group-1",
      target: {
        key: "group-1",
      },
    });

    items = trackStartMenuRecentWindow(items, {
      appId: "direct_chat",
      title: "Алиса Купер",
      routePath: "/app/chats?chat=chat-1&from=start",
      target: {
        key: "chat-1",
      },
    });

    expect(items).toEqual([
      {
        id: "direct_chat:chat-1",
        kind: "direct_chat",
        targetKey: "chat-1",
        title: "Алиса Купер",
        routePath: "/app/chats?chat=chat-1&from=start",
      },
      {
        id: "group_chat:group-1",
        kind: "group_chat",
        targetKey: "group-1",
        title: "Design",
        routePath: "/app/groups?group=group-1",
      },
    ]);
  });

  it("keeps explorer as one recent app item while preserving latest route context", () => {
    const items = trackStartMenuRecentWindow([], {
      appId: "explorer",
      title: "Explorer · Работа",
      routePath: "/app/explorer?folder=folder-1",
      target: {
        key: "explorer",
      },
    });

    expect(items).toEqual([
      {
        id: "app:explorer",
        kind: "app",
        appId: "explorer",
        title: "Explorer · Работа",
        routePath: "/app/explorer?folder=folder-1",
      },
    ]);
  });

  it("persists bounded recent items in browser-local storage", () => {
    const storage = new MemoryStorage();
    let items = [] as ReturnType<typeof readStartMenuRecentItems>;

    for (let index = 1; index <= MAX_START_MENU_RECENT_ITEMS + 3; index += 1) {
      items = trackStartMenuRecentWindow(items, {
        appId: "direct_chat",
        title: `Chat ${index}`,
        routePath: `/app/chats?chat=chat-${index}`,
        target: {
          key: `chat-${index}`,
        },
      });
    }

    writeStartMenuRecentItems(storage, items);

    const restoredItems = readStartMenuRecentItems(storage);
    expect(restoredItems).toHaveLength(MAX_START_MENU_RECENT_ITEMS);
    expect(restoredItems[0]?.id).toBe(`direct_chat:chat-${MAX_START_MENU_RECENT_ITEMS + 3}`);
    expect(restoredItems.at(-1)?.id).toBe("direct_chat:chat-4");
  });
});

describe("extractSearchParamsFromRoutePath", () => {
  it("returns the query params from a stored launcher route", () => {
    const params = extractSearchParamsFromRoutePath("/app/chats?chat=chat-7&call=return");

    expect(params?.get("chat")).toBe("chat-7");
    expect(params?.get("call")).toBe("return");
  });
});

describe("resolveStartMenuRecentItemRoutePath", () => {
  it("builds canonical fallback route for recent direct chats without stored path", () => {
    expect(
      resolveStartMenuRecentItemRoutePath({
        id: "direct_chat:chat-9",
        kind: "direct_chat",
        targetKey: "chat-9",
        title: "Алиса",
        routePath: null,
      }),
    ).toBe("/app/chats?chat=chat-9");
  });
});
