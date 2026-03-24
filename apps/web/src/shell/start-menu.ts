import type { ShellPreferencesStorageLike } from "./preferences";
import type { ShellWindow } from "./runtime";

const startMenuRecentStorageKey = "aerochat.shell.start-menu.recent.v1";

export const MAX_START_MENU_RECENT_ITEMS = 7;
export const MAX_START_MENU_FOLDER_ITEMS = 4;

export type StartMenuLauncherAppId =
  | "self_chat"
  | "explorer"
  | "search"
  | "friend_requests"
  | "chats"
  | "groups";

export type StartMenuRecentAppId = StartMenuLauncherAppId | "settings";

export interface StartMenuLauncherAppEntry {
  appId: StartMenuLauncherAppId;
  badge: string;
  description: string;
  title: string;
}

export interface StartMenuPanelState {
  isOpen: boolean;
}

export type StartMenuPanelAction =
  | { type: "open" }
  | { type: "close" }
  | { type: "toggle" };

export interface StartMenuRecentAppItem {
  id: string;
  kind: "app";
  appId: StartMenuRecentAppId;
  routePath: string | null;
  title: string;
}

export interface StartMenuRecentDirectChatItem {
  id: string;
  kind: "direct_chat";
  routePath: string | null;
  targetKey: string;
  title: string;
}

export interface StartMenuRecentGroupChatItem {
  id: string;
  kind: "group_chat";
  routePath: string | null;
  targetKey: string;
  title: string;
}

export type StartMenuRecentItem =
  | StartMenuRecentAppItem
  | StartMenuRecentDirectChatItem
  | StartMenuRecentGroupChatItem;

export const startMenuLauncherApps: readonly StartMenuLauncherAppEntry[] = [
  {
    appId: "self_chat",
    badge: "Я",
    title: "Я",
    description: "Канонический self-facing workspace для текущего пользователя.",
  },
  {
    appId: "explorer",
    badge: "Ex",
    title: "Explorer",
    description: "Organizer surface для desktop entrypoints, hidden state и custom folders.",
  },
  {
    appId: "search",
    badge: "По",
    title: "Поиск",
    description: "Отдельное search-приложение с текущими privacy и encrypted boundaries.",
  },
  {
    appId: "friend_requests",
    badge: "З",
    title: "Заявки",
    description: "Friend requests без дублирования singleton window.",
  },
  {
    appId: "chats",
    badge: "Ч",
    title: "Чаты",
    description: "Launcher/list surface для всех direct chats, если нужен быстрый обзор.",
  },
  {
    appId: "groups",
    badge: "Г",
    title: "Группы",
    description: "Launcher/list surface для групп и открытия canonical group targets.",
  },
];

const recentEligibleAppIds = new Set<StartMenuRecentAppId>([
  "self_chat",
  "explorer",
  "search",
  "friend_requests",
  "settings",
  "chats",
  "groups",
]);

export function createInitialStartMenuPanelState(): StartMenuPanelState {
  return {
    isOpen: false,
  };
}

export function startMenuPanelReducer(
  state: StartMenuPanelState,
  action: StartMenuPanelAction,
): StartMenuPanelState {
  switch (action.type) {
    case "open":
      return state.isOpen ? state : { isOpen: true };
    case "close":
      return state.isOpen ? { isOpen: false } : state;
    case "toggle":
      return { isOpen: !state.isOpen };
    default:
      return state;
  }
}

export function readStartMenuRecentItems(
  storage: ShellPreferencesStorageLike | null,
): StartMenuRecentItem[] {
  if (storage === null) {
    return [];
  }

  try {
    const raw = storage.getItem(startMenuRecentStorageKey);
    if (raw === null || raw.trim() === "") {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeStartMenuRecentItem)
      .filter((item): item is StartMenuRecentItem => item !== null)
      .slice(0, MAX_START_MENU_RECENT_ITEMS);
  } catch {
    return [];
  }
}

export function writeStartMenuRecentItems(
  storage: ShellPreferencesStorageLike | null,
  items: StartMenuRecentItem[],
): void {
  if (storage === null) {
    return;
  }

  try {
    storage.setItem(
      startMenuRecentStorageKey,
      JSON.stringify(items.slice(0, MAX_START_MENU_RECENT_ITEMS)),
    );
  } catch {
    // Локальное хранилище может быть недоступно, но launcher не должен из-за этого ломаться.
  }
}

export function trackStartMenuRecentWindow(
  items: StartMenuRecentItem[],
  window: Pick<ShellWindow, "appId" | "target" | "title" | "routePath">,
): StartMenuRecentItem[] {
  const nextItem = resolveStartMenuRecentItem(window);
  if (nextItem === null) {
    return items;
  }

  const deduplicatedItems = items.filter((item) => item.id !== nextItem.id);
  const nextItems = [nextItem, ...deduplicatedItems].slice(0, MAX_START_MENU_RECENT_ITEMS);

  if (items.length === nextItems.length && items.every((item, index) => isSameRecentItem(item, nextItems[index]!))) {
    return items;
  }

  return nextItems;
}

export function extractSearchParamsFromRoutePath(
  routePath: string | null,
): URLSearchParams | null {
  const normalizedRoutePath = routePath?.trim() ?? "";
  if (normalizedRoutePath === "") {
    return null;
  }

  try {
    const parsed = new URL(normalizedRoutePath, "https://shell.aerochat.local");
    return new URLSearchParams(parsed.search);
  } catch {
    const queryIndex = normalizedRoutePath.indexOf("?");
    if (queryIndex === -1) {
      return new URLSearchParams();
    }

    return new URLSearchParams(normalizedRoutePath.slice(queryIndex + 1));
  }
}

export function describeStartMenuRecentItemMeta(item: StartMenuRecentItem): string {
  if (item.kind === "direct_chat") {
    return "Личный чат";
  }

  if (item.kind === "group_chat") {
    return "Группа";
  }

  return "Приложение";
}

export function describeStartMenuRecentItemBadge(item: StartMenuRecentItem): string {
  if (item.kind === "direct_chat") {
    return "ЛЧ";
  }

  if (item.kind === "group_chat") {
    return "ГР";
  }

  if (item.appId === "self_chat") {
    return "Я";
  }

  if (item.appId === "explorer") {
    return "Ex";
  }

  if (item.appId === "search") {
    return "По";
  }

  if (item.appId === "friend_requests") {
    return "З";
  }

  if (item.appId === "settings") {
    return "Н";
  }

  if (item.appId === "groups") {
    return "Г";
  }

  return "Ч";
}

function resolveStartMenuRecentItem(
  window: Pick<ShellWindow, "appId" | "target" | "title" | "routePath">,
): StartMenuRecentItem | null {
  const title = normalizeRecentTitle(window.title, "AeroChat");

  if (window.appId === "direct_chat") {
    const targetKey = window.target?.key?.trim() ?? "";
    if (targetKey === "") {
      return null;
    }

    return {
      id: `direct_chat:${targetKey}`,
      kind: "direct_chat",
      targetKey,
      title,
      routePath: window.routePath,
    };
  }

  if (window.appId === "group_chat") {
    const targetKey = window.target?.key?.trim() ?? "";
    if (targetKey === "") {
      return null;
    }

    return {
      id: `group_chat:${targetKey}`,
      kind: "group_chat",
      targetKey,
      title,
      routePath: window.routePath,
    };
  }

  if (!recentEligibleAppIds.has(window.appId as StartMenuRecentAppId)) {
    return null;
  }

  return {
    id: `app:${window.appId}`,
    kind: "app",
    appId: window.appId as StartMenuRecentAppId,
    title,
    routePath: window.routePath,
  };
}

function normalizeStartMenuRecentItem(input: unknown): StartMenuRecentItem | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as Partial<StartMenuRecentItem>;
  const kind = value.kind;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const title = typeof value.title === "string" ? value.title : "";
  const routePath =
    typeof value.routePath === "string" || value.routePath === null ? value.routePath : null;

  if (id === "") {
    return null;
  }

  if (kind === "app") {
    const appId =
      typeof value.appId === "string" && recentEligibleAppIds.has(value.appId as StartMenuRecentAppId)
        ? (value.appId as StartMenuRecentAppId)
        : null;
    if (appId === null) {
      return null;
    }

    return {
      id,
      kind,
      appId,
      title: normalizeRecentTitle(title, "Приложение"),
      routePath,
    };
  }

  if (kind === "direct_chat" || kind === "group_chat") {
    const targetKey =
      typeof (value as { targetKey?: unknown }).targetKey === "string"
        ? (((value as { targetKey?: string }).targetKey ?? "").trim())
        : "";
    if (targetKey === "") {
      return null;
    }

    return {
      id,
      kind,
      targetKey,
      title: normalizeRecentTitle(title, kind === "direct_chat" ? "Личный чат" : "Группа"),
      routePath,
    };
  }

  return null;
}

function isSameRecentItem(
  left: StartMenuRecentItem,
  right: StartMenuRecentItem,
): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.title === right.title &&
    left.routePath === right.routePath &&
    ("appId" in left ? left.appId === (right as StartMenuRecentAppItem).appId : true) &&
    ("targetKey" in left
      ? left.targetKey === (right as StartMenuRecentDirectChatItem | StartMenuRecentGroupChatItem).targetKey
      : true)
  );
}

function normalizeRecentTitle(title: string, fallbackValue: string): string {
  const normalizedTitle = title.trim();
  return normalizedTitle === "" ? fallbackValue : normalizedTitle;
}
