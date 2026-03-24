import type { DirectChat, Group } from "../gateway/types";
import { shellAppRegistry } from "../app/app-routes";
import type { ShellPreferencesStorageLike } from "./preferences";

const desktopRegistryStorageKey = "aerochat.shell.desktop-registry.v1";

export const MAX_VISIBLE_DESKTOP_ENTRIES = 10;

export type DesktopEntityKind = "system_app" | "direct_chat" | "group_chat";
export type DesktopEntityVisibility = "visible" | "hidden";
export type DesktopEntityPlacement = "desktop" | "overflow";
export type DesktopOverflowBucket = "contacts" | "groups" | null;

interface DesktopEntityBase {
  id: string;
  kind: DesktopEntityKind;
  title: string;
  visibility: DesktopEntityVisibility;
  placement: DesktopEntityPlacement;
  overflowBucket: DesktopOverflowBucket;
  order: number;
}

export interface DesktopSystemAppEntity extends DesktopEntityBase {
  kind: "system_app";
  appId: DesktopSystemAppId;
  targetKey: DesktopSystemAppId;
}

export interface DesktopDirectChatEntity extends DesktopEntityBase {
  kind: "direct_chat";
  appId: "direct_chat";
  targetKey: string;
}

export interface DesktopGroupChatEntity extends DesktopEntityBase {
  kind: "group_chat";
  appId: "group_chat";
  targetKey: string;
}

export type DesktopEntity =
  | DesktopSystemAppEntity
  | DesktopDirectChatEntity
  | DesktopGroupChatEntity;

export interface DesktopRegistryState {
  entries: DesktopEntity[];
  nextOrder: number;
}

export interface DesktopOverflowSummary {
  bucket: Exclude<DesktopOverflowBucket, null>;
  title: string;
  count: number;
}

export type DesktopSystemAppId =
  | "self_chat"
  | "search"
  | "explorer"
  | "friend_requests"
  | "settings";

interface DesktopSourceEntry {
  id: string;
  title: string;
}

const mandatorySystemEntries: readonly {
  appId: DesktopSystemAppId;
  title: string;
  order: number;
}[] = [
  { appId: "self_chat", title: shellAppRegistry.self_chat.title, order: 1 },
  { appId: "search", title: shellAppRegistry.search.title, order: 2 },
  { appId: "explorer", title: shellAppRegistry.explorer.title, order: 3 },
  { appId: "friend_requests", title: shellAppRegistry.friend_requests.title, order: 4 },
  { appId: "settings", title: shellAppRegistry.settings.title, order: 5 },
];

export function createInitialDesktopRegistryState(): DesktopRegistryState {
  return normalizeDesktopRegistryState({
    entries: mandatorySystemEntries.map((entry) => createSystemEntity(entry.appId, entry.title, entry.order)),
    nextOrder: mandatorySystemEntries.length + 1,
  });
}

export function readDesktopRegistryState(
  storage: ShellPreferencesStorageLike | null,
): DesktopRegistryState {
  if (storage === null) {
    return createInitialDesktopRegistryState();
  }

  try {
    const raw = storage.getItem(desktopRegistryStorageKey);
    if (raw === null || raw.trim() === "") {
      return createInitialDesktopRegistryState();
    }

    const parsed = JSON.parse(raw) as {
      entries?: unknown;
      nextOrder?: unknown;
    };

    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.map(normalizeDesktopEntity).filter((entry): entry is DesktopEntity => entry !== null)
      : [];
    const nextOrder =
      typeof parsed.nextOrder === "number" && Number.isFinite(parsed.nextOrder)
        ? parsed.nextOrder
        : mandatorySystemEntries.length + 1;

    return normalizeDesktopRegistryState({
      entries,
      nextOrder,
    });
  } catch {
    return createInitialDesktopRegistryState();
  }
}

export function writeDesktopRegistryState(
  storage: ShellPreferencesStorageLike | null,
  state: DesktopRegistryState,
): void {
  if (storage === null) {
    return;
  }

  try {
    storage.setItem(desktopRegistryStorageKey, JSON.stringify(state));
  } catch {
    // Локальное хранилище может быть недоступно в текущем окружении.
  }
}

export function upsertDirectChatDesktopEntity(
  state: DesktopRegistryState,
  chatId: string,
  title: string,
): DesktopRegistryState {
  return upsertEntity(state, {
    id: buildDesktopEntityId("direct_chat", chatId),
    kind: "direct_chat",
    appId: "direct_chat",
    targetKey: chatId,
    title: normalizeDesktopEntityTitle(title, "Личный чат"),
    visibility: "visible",
    placement: "desktop",
    overflowBucket: null,
    order: state.nextOrder,
  });
}

export function upsertGroupChatDesktopEntity(
  state: DesktopRegistryState,
  groupId: string,
  title: string,
): DesktopRegistryState {
  return upsertEntity(state, {
    id: buildDesktopEntityId("group_chat", groupId),
    kind: "group_chat",
    appId: "group_chat",
    targetKey: groupId,
    title: normalizeDesktopEntityTitle(title, "Группа"),
    visibility: "visible",
    placement: "desktop",
    overflowBucket: null,
    order: state.nextOrder,
  });
}

export function hideDesktopEntity(
  state: DesktopRegistryState,
  entryId: string,
): DesktopRegistryState {
  const nextEntries = state.entries.map((entry) =>
    entry.id !== entryId || entry.kind === "system_app"
      ? entry
      : {
          ...entry,
          visibility: "hidden" as const,
        },
  );

  return normalizeDesktopRegistryState({
    entries: nextEntries,
    nextOrder: state.nextOrder,
  });
}

export function syncDirectChatDesktopEntities(
  state: DesktopRegistryState,
  chats: DirectChat[],
  currentUserId: string,
): DesktopRegistryState {
  return syncSourceEntities(
    state,
    chats.map((chat) => ({
      id: chat.id,
      title: describeDirectChatDesktopTitle(chat, currentUserId),
    })),
    "direct_chat",
  );
}

export function syncGroupChatDesktopEntities(
  state: DesktopRegistryState,
  groups: Group[],
): DesktopRegistryState {
  return syncSourceEntities(
    state,
    groups.map((group) => ({
      id: group.id,
      title: normalizeDesktopEntityTitle(group.name, "Группа"),
    })),
    "group_chat",
  );
}

export function removeDirectChatDesktopEntity(
  state: DesktopRegistryState,
  chatId: string,
): DesktopRegistryState {
  return removeDesktopEntity(state, buildDesktopEntityId("direct_chat", chatId));
}

export function removeGroupChatDesktopEntity(
  state: DesktopRegistryState,
  groupId: string,
): DesktopRegistryState {
  return removeDesktopEntity(state, buildDesktopEntityId("group_chat", groupId));
}

export function listDesktopEntitiesForSurface(
  state: DesktopRegistryState,
): DesktopEntity[] {
  return state.entries
    .filter((entry) => entry.visibility === "visible" && entry.placement === "desktop")
    .sort(compareDesktopEntities);
}

export function listDesktopOverflowSummaries(
  state: DesktopRegistryState,
): DesktopOverflowSummary[] {
  return (["contacts", "groups"] as const)
    .map((bucket) => ({
      bucket,
      title: bucket === "contacts" ? "Контакты" : "Группы",
      count: state.entries.filter(
        (entry) =>
          entry.visibility === "visible" &&
          entry.placement === "overflow" &&
          entry.overflowBucket === bucket,
      ).length,
    }))
    .filter((entry) => entry.count > 0);
}

export function isDesktopEntityHideable(entry: DesktopEntity): boolean {
  return entry.kind !== "system_app";
}

export function describeDirectChatDesktopTitle(
  chat: DirectChat,
  currentUserId: string,
): string {
  const peer =
    chat.participants.find((participant) => participant.id !== currentUserId) ?? null;
  return normalizeDesktopEntityTitle(
    peer?.nickname ?? peer?.login ?? "",
    "Личный чат",
  );
}

function syncSourceEntities(
  state: DesktopRegistryState,
  entries: DesktopSourceEntry[],
  kind: "direct_chat" | "group_chat",
): DesktopRegistryState {
  let nextState = state;
  for (const entry of entries) {
    nextState =
      kind === "direct_chat"
        ? upsertDirectChatDesktopEntity(nextState, entry.id, entry.title)
        : upsertGroupChatDesktopEntity(nextState, entry.id, entry.title);
  }

  const sourceIds = new Set(entries.map((entry) => entry.id));
  nextState = {
    ...nextState,
    entries: nextState.entries.filter((entry) =>
      entry.kind !== kind ? true : sourceIds.has(entry.targetKey),
    ),
  };

  return normalizeDesktopRegistryState(nextState);
}

function upsertEntity(
  state: DesktopRegistryState,
  entry: DesktopDirectChatEntity | DesktopGroupChatEntity,
): DesktopRegistryState {
  const existingEntry = state.entries.find((currentEntry) => currentEntry.id === entry.id) ?? null;
  const nextEntries =
    existingEntry === null
      ? [...state.entries, entry]
      : state.entries.map((currentEntry) =>
          currentEntry.id !== entry.id
            ? currentEntry
            : {
                ...currentEntry,
                title: entry.title,
              },
        );

  return normalizeDesktopRegistryState({
    entries: nextEntries,
    nextOrder: existingEntry === null ? state.nextOrder + 1 : state.nextOrder,
  });
}

function removeDesktopEntity(
  state: DesktopRegistryState,
  entryId: string,
): DesktopRegistryState {
  return normalizeDesktopRegistryState({
    entries: state.entries.filter((entry) => entry.id !== entryId),
    nextOrder: state.nextOrder,
  });
}

function normalizeDesktopRegistryState(
  input: DesktopRegistryState,
): DesktopRegistryState {
  const byId = new Map<string, DesktopEntity>();

  for (const entry of input.entries) {
    byId.set(entry.id, entry);
  }

  for (const systemEntry of mandatorySystemEntries) {
    byId.set(
      buildDesktopEntityId("system_app", systemEntry.appId),
      createSystemEntity(systemEntry.appId, systemEntry.title, systemEntry.order),
    );
  }

  const systemEntries: DesktopSystemAppEntity[] = mandatorySystemEntries.map((entry) => {
    const currentEntry =
      byId.get(buildDesktopEntityId("system_app", entry.appId)) ?? createSystemEntity(entry.appId, entry.title, entry.order);
    return createSystemEntity(
      entry.appId,
      currentEntry.title,
      entry.order,
    );
  });

  const dynamicEntries = [...byId.values()]
    .filter((entry) => entry.kind !== "system_app")
    .sort(compareDesktopEntities);

  const availableDesktopSlots = Math.max(
    0,
    MAX_VISIBLE_DESKTOP_ENTRIES - systemEntries.length,
  );
  let usedDesktopSlots = 0;

  const normalizedDynamicEntries: DesktopEntity[] = dynamicEntries.map((entry): DesktopEntity => {
    if (entry.visibility === "hidden") {
      return normalizeHiddenDynamicEntry(entry);
    }

    if (usedDesktopSlots < availableDesktopSlots) {
      usedDesktopSlots += 1;
      return placeDynamicEntryOnDesktop(entry);
    }

    return placeDynamicEntryOnOverflow(entry);
  });

  const nextOrder = Math.max(
    input.nextOrder,
    mandatorySystemEntries.length + 1,
    ...normalizedDynamicEntries.map((entry) => entry.order + 1),
  );

  return {
    entries: [...systemEntries, ...normalizedDynamicEntries],
    nextOrder,
  };
}

function normalizeHiddenDynamicEntry(
  entry: DesktopDirectChatEntity | DesktopGroupChatEntity,
): DesktopDirectChatEntity | DesktopGroupChatEntity {
  if (entry.kind === "direct_chat") {
    return {
      ...entry,
      overflowBucket: entry.overflowBucket ?? "contacts",
    };
  }

  return {
    ...entry,
    overflowBucket: entry.overflowBucket ?? "groups",
  };
}

function placeDynamicEntryOnDesktop(
  entry: DesktopDirectChatEntity | DesktopGroupChatEntity,
): DesktopDirectChatEntity | DesktopGroupChatEntity {
  return {
    ...entry,
    placement: "desktop",
    overflowBucket: null,
  };
}

function placeDynamicEntryOnOverflow(
  entry: DesktopDirectChatEntity | DesktopGroupChatEntity,
): DesktopDirectChatEntity | DesktopGroupChatEntity {
  if (entry.kind === "direct_chat") {
    return {
      ...entry,
      placement: "overflow",
      overflowBucket: "contacts",
    };
  }

  return {
    ...entry,
    placement: "overflow",
    overflowBucket: "groups",
  };
}

function compareDesktopEntities(left: DesktopEntity, right: DesktopEntity): number {
  if (left.order === right.order) {
    return left.id.localeCompare(right.id);
  }

  return left.order - right.order;
}

function normalizeDesktopEntity(
  input: unknown,
): DesktopEntity | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as Partial<DesktopEntity>;
  const kind = readDesktopEntityKind(value.kind);
  if (kind === null) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id : "";
  const targetKey = typeof value.targetKey === "string" ? value.targetKey : "";
  const title = typeof value.title === "string" ? value.title : "";
  const order =
    typeof value.order === "number" && Number.isFinite(value.order) ? value.order : 0;
  const visibility = value.visibility === "hidden" ? "hidden" : "visible";
  const placement = value.placement === "overflow" ? "overflow" : "desktop";
  const overflowBucket = readDesktopOverflowBucket(value.overflowBucket);

  if (kind === "system_app") {
    const appId = readSystemAppId(value.appId);
    if (appId === null) {
      return null;
    }

    return {
      id:
        id === "" ? buildDesktopEntityId("system_app", appId) : id,
      kind,
      appId,
      targetKey: appId,
      title: normalizeDesktopEntityTitle(title, shellAppRegistry[appId].title),
      visibility: "visible",
      placement: "desktop",
      overflowBucket: null,
      order,
    };
  }

  if (targetKey === "") {
    return null;
  }

  if (kind === "direct_chat") {
    return {
      id: id === "" ? buildDesktopEntityId(kind, targetKey) : id,
      kind,
      appId: "direct_chat",
      targetKey,
      title: normalizeDesktopEntityTitle(title, "Личный чат"),
      visibility,
      placement,
      overflowBucket,
      order,
    };
  }

  return {
    id: id === "" ? buildDesktopEntityId(kind, targetKey) : id,
    kind,
    appId: "group_chat",
    targetKey,
    title: normalizeDesktopEntityTitle(title, "Группа"),
    visibility,
    placement,
    overflowBucket,
    order,
  };
}

function createSystemEntity(
  appId: DesktopSystemAppId,
  title: string,
  order: number,
): DesktopSystemAppEntity {
  return {
    id: buildDesktopEntityId("system_app", appId),
    kind: "system_app",
    appId,
    targetKey: appId,
    title: normalizeDesktopEntityTitle(title, shellAppRegistry[appId].title),
    visibility: "visible",
    placement: "desktop",
    overflowBucket: null,
    order,
  };
}

function buildDesktopEntityId(
  kind: DesktopEntityKind,
  targetKey: string,
): string {
  return `${kind}:${targetKey}`;
}

function normalizeDesktopEntityTitle(title: string, fallbackTitle: string): string {
  const normalizedTitle = title.trim();
  return normalizedTitle === "" ? fallbackTitle : normalizedTitle;
}

function readDesktopEntityKind(value: unknown): DesktopEntityKind | null {
  return value === "system_app" || value === "direct_chat" || value === "group_chat"
    ? value
    : null;
}

function readSystemAppId(value: unknown): DesktopSystemAppId | null {
  return value === "self_chat" ||
    value === "search" ||
    value === "explorer" ||
    value === "friend_requests" ||
    value === "settings"
    ? value
    : null;
}

function readDesktopOverflowBucket(value: unknown): DesktopOverflowBucket {
  if (value === "contacts" || value === "groups") {
    return value;
  }

  return null;
}
