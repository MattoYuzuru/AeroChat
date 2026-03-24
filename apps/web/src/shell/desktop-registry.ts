import type { DirectChat, Group } from "../gateway/types";
import type { ShellPreferencesStorageLike } from "./preferences";

const desktopRegistryStorageKey = "aerochat.shell.desktop-registry.v1";

export const MAX_VISIBLE_DESKTOP_ENTRIES = 10;

export type DesktopEntityKind =
  | "system_app"
  | "direct_chat"
  | "group_chat"
  | "custom_folder";
export type DesktopEntityVisibility = "visible" | "hidden";
export type DesktopEntityPlacement = "desktop" | "overflow";
export type DesktopOverflowBucket = "contacts" | "groups" | "folders" | null;
export type DesktopFolderReferenceTargetKind = "direct_chat" | "group_chat";

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

export interface DesktopCustomFolderEntity extends DesktopEntityBase {
  kind: "custom_folder";
  appId: "explorer";
  targetKey: string;
  folderId: string;
}

export type DesktopEntity =
  | DesktopSystemAppEntity
  | DesktopDirectChatEntity
  | DesktopGroupChatEntity
  | DesktopCustomFolderEntity;

export interface DesktopFolderReferenceTarget {
  kind: DesktopFolderReferenceTargetKind;
  targetKey: string;
}

export interface DesktopFolderMemberReference {
  id: string;
  folderId: string;
  target: DesktopFolderReferenceTarget;
  order: number;
}

export interface DesktopFolderMemberEntryRecord {
  reference: DesktopFolderMemberReference;
  entry: DesktopDirectChatEntity | DesktopGroupChatEntity;
}

export interface DesktopRegistryState {
  entries: DesktopEntity[];
  folderMembers: DesktopFolderMemberReference[];
  nextOrder: number;
  nextFolderSequence: number;
  nextFolderMemberSequence: number;
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

export type DesktopUnreadTargetMap = ReadonlyMap<string, boolean>;

interface DesktopSourceEntry {
  id: string;
  title: string;
}

const desktopSystemAppTitles: Record<DesktopSystemAppId, string> = {
  self_chat: "Я",
  search: "Поиск",
  explorer: "Explorer",
  friend_requests: "Заявки",
  settings: "Настройки",
};

const mandatorySystemEntries: readonly {
  appId: DesktopSystemAppId;
  title: string;
  order: number;
}[] = [
  { appId: "self_chat", title: desktopSystemAppTitles.self_chat, order: 1 },
  { appId: "search", title: desktopSystemAppTitles.search, order: 2 },
  { appId: "explorer", title: desktopSystemAppTitles.explorer, order: 3 },
  { appId: "friend_requests", title: desktopSystemAppTitles.friend_requests, order: 4 },
  { appId: "settings", title: desktopSystemAppTitles.settings, order: 5 },
];

export function createInitialDesktopRegistryState(): DesktopRegistryState {
  return normalizeDesktopRegistryState({
    entries: mandatorySystemEntries.map((entry) =>
      createSystemEntity(entry.appId, entry.title, entry.order),
    ),
    folderMembers: [],
    nextOrder: mandatorySystemEntries.length + 1,
    nextFolderSequence: 1,
    nextFolderMemberSequence: 1,
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
      folderMembers?: unknown;
      nextOrder?: unknown;
      nextFolderSequence?: unknown;
      nextFolderMemberSequence?: unknown;
    };

    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map(normalizeDesktopEntity)
          .filter((entry): entry is DesktopEntity => entry !== null)
      : [];
    const folderMembers = Array.isArray(parsed.folderMembers)
      ? parsed.folderMembers
          .map(normalizeDesktopFolderMemberReference)
          .filter((reference): reference is DesktopFolderMemberReference => reference !== null)
      : [];

    return normalizeDesktopRegistryState({
      entries,
      folderMembers,
      nextOrder: readPositiveNumber(parsed.nextOrder, mandatorySystemEntries.length + 1),
      nextFolderSequence: readPositiveNumber(parsed.nextFolderSequence, 1),
      nextFolderMemberSequence: readPositiveNumber(parsed.nextFolderMemberSequence, 1),
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

export function createCustomFolderDesktopEntity(
  state: DesktopRegistryState,
  name: string,
): DesktopRegistryState {
  const folderId = `folder-${state.nextFolderSequence}`;

  return normalizeDesktopRegistryState({
    entries: [
      ...state.entries,
      {
        id: buildDesktopEntityId("custom_folder", folderId),
        kind: "custom_folder",
        appId: "explorer",
        folderId,
        targetKey: folderId,
        title: normalizeDesktopEntityTitle(name, "Новая папка"),
        visibility: "visible",
        placement: "desktop",
        overflowBucket: null,
        order: resolveNextCreatedFolderOrder(state),
      },
    ],
    folderMembers: state.folderMembers,
    nextOrder: state.nextOrder,
    nextFolderSequence: state.nextFolderSequence + 1,
    nextFolderMemberSequence: state.nextFolderMemberSequence,
  });
}

export function renameCustomFolderDesktopEntity(
  state: DesktopRegistryState,
  folderId: string,
  name: string,
): DesktopRegistryState {
  const nextEntries = state.entries.map((entry) =>
    entry.kind !== "custom_folder" || entry.folderId !== folderId
      ? entry
      : {
          ...entry,
          title: normalizeDesktopEntityTitle(name, entry.title),
        },
  );

  return normalizeDesktopRegistryState({
    ...state,
    entries: nextEntries,
  });
}

export function deleteCustomFolderDesktopEntity(
  state: DesktopRegistryState,
  folderId: string,
): DesktopRegistryState {
  return normalizeDesktopRegistryState({
    entries: state.entries.filter(
      (entry) => entry.kind !== "custom_folder" || entry.folderId !== folderId,
    ),
    folderMembers: state.folderMembers.filter((reference) => reference.folderId !== folderId),
    nextOrder: state.nextOrder,
    nextFolderSequence: state.nextFolderSequence,
    nextFolderMemberSequence: state.nextFolderMemberSequence,
  });
}

export function addCustomFolderMemberReference(
  state: DesktopRegistryState,
  folderId: string,
  target: DesktopFolderReferenceTarget,
): DesktopRegistryState {
  const folder = getCustomFolderDesktopEntity(state, folderId);
  if (folder === null) {
    return state;
  }

  const normalizedTarget = normalizeFolderReferenceTarget(target);
  if (normalizedTarget === null || resolveDesktopTargetEntry(state, normalizedTarget) === null) {
    return state;
  }

  const existingReference = state.folderMembers.find(
    (reference) =>
      reference.folderId === folder.folderId &&
      reference.target.kind === normalizedTarget.kind &&
      reference.target.targetKey === normalizedTarget.targetKey,
  );
  if (existingReference) {
    return state;
  }

  return normalizeDesktopRegistryState({
    entries: state.entries,
    folderMembers: [
      ...state.folderMembers,
      {
        id: `folder-member-${state.nextFolderMemberSequence}`,
        folderId: folder.folderId,
        target: normalizedTarget,
        order: state.nextFolderMemberSequence,
      },
    ],
    nextOrder: state.nextOrder,
    nextFolderSequence: state.nextFolderSequence,
    nextFolderMemberSequence: state.nextFolderMemberSequence + 1,
  });
}

export function removeCustomFolderMemberReference(
  state: DesktopRegistryState,
  referenceId: string,
): DesktopRegistryState {
  return normalizeDesktopRegistryState({
    entries: state.entries,
    folderMembers: state.folderMembers.filter((reference) => reference.id !== referenceId),
    nextOrder: state.nextOrder,
    nextFolderSequence: state.nextFolderSequence,
    nextFolderMemberSequence: state.nextFolderMemberSequence,
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
    ...state,
    entries: nextEntries,
  });
}

export function showDesktopEntityOnDesktop(
  state: DesktopRegistryState,
  entryId: string,
): DesktopRegistryState {
  const targetEntry = state.entries.find((entry) => entry.id === entryId) ?? null;
  if (targetEntry === null || targetEntry.kind === "system_app") {
    return state;
  }

  const promotedOrder = resolvePromotedDesktopOrder(state, targetEntry.id);
  const nextEntries = state.entries.map((entry) =>
    entry.id !== entryId || entry.kind === "system_app"
      ? entry
      : {
          ...entry,
          visibility: "visible" as const,
          placement: "desktop" as const,
          overflowBucket: null,
          order: promotedOrder,
        },
  );

  return normalizeDesktopRegistryState({
    ...state,
    entries: nextEntries,
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

export function listDesktopRegistryEntities(
  state: DesktopRegistryState,
): DesktopEntity[] {
  return [...state.entries].sort(compareDesktopEntities);
}

export function listHiddenDesktopEntities(
  state: DesktopRegistryState,
): DesktopEntity[] {
  return state.entries
    .filter((entry) => entry.visibility === "hidden")
    .sort(compareDesktopEntities);
}

export function listDesktopOverflowEntities(
  state: DesktopRegistryState,
  bucket?: Exclude<DesktopOverflowBucket, null>,
): DesktopEntity[] {
  return state.entries
    .filter(
      (entry) =>
        entry.visibility === "visible" &&
        entry.placement === "overflow" &&
        (bucket === undefined || entry.overflowBucket === bucket),
    )
    .sort(compareDesktopEntities);
}

export function listDesktopOverflowSummaries(
  state: DesktopRegistryState,
): DesktopOverflowSummary[] {
  return (["contacts", "groups", "folders"] as const)
    .map((bucket) => ({
      bucket,
      title: describeOverflowBucket(bucket),
      count: state.entries.filter(
        (entry) =>
          entry.visibility === "visible" &&
          entry.placement === "overflow" &&
          entry.overflowBucket === bucket,
      ).length,
    }))
    .filter((entry) => entry.count > 0);
}

export function listCustomFolderDesktopEntities(
  state: DesktopRegistryState,
): DesktopCustomFolderEntity[] {
  return state.entries
    .filter((entry): entry is DesktopCustomFolderEntity => entry.kind === "custom_folder")
    .sort(compareDesktopEntities);
}

export function getCustomFolderDesktopEntity(
  state: DesktopRegistryState,
  folderId: string,
): DesktopCustomFolderEntity | null {
  return (
    state.entries.find(
      (entry): entry is DesktopCustomFolderEntity =>
        entry.kind === "custom_folder" && entry.folderId === folderId,
    ) ?? null
  );
}

export function listCustomFolderMemberReferences(
  state: DesktopRegistryState,
  folderId: string,
): DesktopFolderMemberReference[] {
  return state.folderMembers
    .filter((reference) => reference.folderId === folderId)
    .sort(compareFolderMemberReferences);
}

export function listCustomFolderMemberEntryRecords(
  state: DesktopRegistryState,
  folderId: string,
): DesktopFolderMemberEntryRecord[] {
  return listCustomFolderMemberReferences(state, folderId)
    .map((reference) => {
      const entry = resolveDesktopTargetEntry(state, reference.target);
      if (entry === null) {
        return null;
      }

      return {
        reference,
        entry,
      };
    })
    .filter((record): record is DesktopFolderMemberEntryRecord => record !== null);
}

export function createDesktopUnreadTargetMap(
  chats: DirectChat[],
  groups: Group[],
): DesktopUnreadTargetMap {
  const unreadByTarget = new Map<string, boolean>();

  for (const chat of chats) {
    unreadByTarget.set(
      buildDesktopTargetReferenceKey({
        kind: "direct_chat",
        targetKey: chat.id,
      }),
      chat.unreadCount + chat.encryptedUnreadCount > 0,
    );
  }

  for (const group of groups) {
    unreadByTarget.set(
      buildDesktopTargetReferenceKey({
        kind: "group_chat",
        targetKey: group.id,
      }),
      group.unreadCount + group.encryptedUnreadCount > 0,
    );
  }

  return unreadByTarget;
}

export function hasCustomFolderUnreadTargets(
  state: DesktopRegistryState,
  folderId: string,
  unreadByTarget: DesktopUnreadTargetMap,
): boolean {
  return getCustomFolderUnreadCount(state, folderId, unreadByTarget) > 0;
}

export function getCustomFolderUnreadCount(
  state: DesktopRegistryState,
  folderId: string,
  unreadByTarget: DesktopUnreadTargetMap,
): number {
  return listCustomFolderMemberReferences(state, folderId).reduce((count, reference) => {
    return hasDesktopTargetUnread(unreadByTarget, reference.target) ? count + 1 : count;
  }, 0);
}

export function hasDesktopTargetUnread(
  unreadByTarget: DesktopUnreadTargetMap,
  target: DesktopFolderReferenceTarget,
): boolean {
  return unreadByTarget.get(buildDesktopTargetReferenceKey(target)) === true;
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
  return normalizeDesktopEntityTitle(peer?.nickname ?? peer?.login ?? "", "Личный чат");
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
  const existingEntry =
    state.entries.find((currentEntry) => currentEntry.id === entry.id) ?? null;
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
    folderMembers: state.folderMembers,
    nextOrder: existingEntry === null ? state.nextOrder + 1 : state.nextOrder,
    nextFolderSequence: state.nextFolderSequence,
    nextFolderMemberSequence: state.nextFolderMemberSequence,
  });
}

function removeDesktopEntity(
  state: DesktopRegistryState,
  entryId: string,
): DesktopRegistryState {
  return normalizeDesktopRegistryState({
    entries: state.entries.filter((entry) => entry.id !== entryId),
    folderMembers: state.folderMembers,
    nextOrder: state.nextOrder,
    nextFolderSequence: state.nextFolderSequence,
    nextFolderMemberSequence: state.nextFolderMemberSequence,
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
      byId.get(buildDesktopEntityId("system_app", entry.appId)) ??
      createSystemEntity(entry.appId, entry.title, entry.order);
    return createSystemEntity(entry.appId, currentEntry.title, entry.order);
  });

  const dynamicEntries = [...byId.values()]
    .filter((entry) => entry.kind !== "system_app")
    .sort(compareDesktopEntities);

  const availableDesktopSlots = Math.max(0, MAX_VISIBLE_DESKTOP_ENTRIES - systemEntries.length);
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

  const validFolderIds = new Set(
    normalizedDynamicEntries
      .filter((entry): entry is DesktopCustomFolderEntity => entry.kind === "custom_folder")
      .map((entry) => entry.folderId),
  );
  const validTargetKeys = new Set(
    normalizedDynamicEntries
      .filter(
        (entry): entry is DesktopDirectChatEntity | DesktopGroupChatEntity =>
          entry.kind === "direct_chat" || entry.kind === "group_chat",
      )
      .map((entry) =>
        buildDesktopTargetReferenceKey({
          kind: entry.kind,
          targetKey: entry.targetKey,
        }),
      ),
  );

  const referenceByIdentity = new Map<string, DesktopFolderMemberReference>();
  for (const reference of [...input.folderMembers].sort(compareFolderMemberReferences)) {
    if (!validFolderIds.has(reference.folderId)) {
      continue;
    }

    const normalizedTarget = normalizeFolderReferenceTarget(reference.target);
    if (
      normalizedTarget === null ||
      !validTargetKeys.has(buildDesktopTargetReferenceKey(normalizedTarget))
    ) {
      continue;
    }

    const identity = `${reference.folderId}:${normalizedTarget.kind}:${normalizedTarget.targetKey}`;
    if (referenceByIdentity.has(identity)) {
      continue;
    }

    referenceByIdentity.set(identity, {
      ...reference,
      target: normalizedTarget,
    });
  }

  const folderMembers = [...referenceByIdentity.values()].sort(compareFolderMemberReferences);
  const nextOrder = Math.max(
    readPositiveNumber(input.nextOrder, mandatorySystemEntries.length + 1),
    mandatorySystemEntries.length + 1,
    ...normalizedDynamicEntries.map((entry) => entry.order + 1),
  );

  return {
    entries: [...systemEntries, ...normalizedDynamicEntries],
    folderMembers,
    nextOrder,
    nextFolderSequence: Math.max(
      readPositiveNumber(input.nextFolderSequence, 1),
      listCustomFolderDesktopEntities({
        entries: [...systemEntries, ...normalizedDynamicEntries],
        folderMembers,
        nextOrder,
        nextFolderSequence: 1,
        nextFolderMemberSequence: 1,
      }).length + 1,
    ),
    nextFolderMemberSequence: Math.max(
      readPositiveNumber(input.nextFolderMemberSequence, 1),
      ...folderMembers.map((reference) => reference.order + 1),
    ),
  };
}

function resolvePromotedDesktopOrder(
  state: DesktopRegistryState,
  entryId: string,
): number {
  const dynamicEntries = state.entries.filter(
    (entry) => entry.kind !== "system_app" && entry.id !== entryId,
  );
  if (dynamicEntries.length === 0) {
    return mandatorySystemEntries.length + 1;
  }

  return Math.min(...dynamicEntries.map((entry) => entry.order)) - 1;
}

function resolveNextCreatedFolderOrder(state: DesktopRegistryState): number {
  const dynamicEntries = state.entries.filter((entry) => entry.kind !== "system_app");
  if (dynamicEntries.length === 0) {
    return mandatorySystemEntries.length + 1;
  }

  return Math.min(...dynamicEntries.map((entry) => entry.order)) - 1;
}

function normalizeHiddenDynamicEntry(
  entry: DesktopDirectChatEntity | DesktopGroupChatEntity | DesktopCustomFolderEntity,
): DesktopDirectChatEntity | DesktopGroupChatEntity | DesktopCustomFolderEntity {
  return {
    ...entry,
    overflowBucket: describeDefaultOverflowBucket(entry.kind),
  };
}

function placeDynamicEntryOnDesktop(
  entry: DesktopDirectChatEntity | DesktopGroupChatEntity | DesktopCustomFolderEntity,
): DesktopDirectChatEntity | DesktopGroupChatEntity | DesktopCustomFolderEntity {
  return {
    ...entry,
    placement: "desktop",
    overflowBucket: null,
  };
}

function placeDynamicEntryOnOverflow(
  entry: DesktopDirectChatEntity | DesktopGroupChatEntity | DesktopCustomFolderEntity,
): DesktopDirectChatEntity | DesktopGroupChatEntity | DesktopCustomFolderEntity {
  return {
    ...entry,
    placement: "overflow",
    overflowBucket: describeDefaultOverflowBucket(entry.kind),
  };
}

function resolveDesktopTargetEntry(
  state: DesktopRegistryState,
  target: DesktopFolderReferenceTarget,
): DesktopDirectChatEntity | DesktopGroupChatEntity | null {
  return (
    state.entries.find(
      (entry): entry is DesktopDirectChatEntity | DesktopGroupChatEntity =>
        entry.kind === target.kind && entry.targetKey === target.targetKey,
    ) ?? null
  );
}

function compareDesktopEntities(left: DesktopEntity, right: DesktopEntity): number {
  if (left.order === right.order) {
    return left.id.localeCompare(right.id);
  }

  return left.order - right.order;
}

function compareFolderMemberReferences(
  left: DesktopFolderMemberReference,
  right: DesktopFolderMemberReference,
): number {
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
  const order = readPositiveNumber(value.order, 0);
  const visibility = value.visibility === "hidden" ? "hidden" : "visible";
  const placement = value.placement === "overflow" ? "overflow" : "desktop";
  const overflowBucket = readDesktopOverflowBucket(value.overflowBucket);

  if (kind === "system_app") {
    const appId = readSystemAppId(value.appId);
    if (appId === null) {
      return null;
    }

    return {
      id: id === "" ? buildDesktopEntityId("system_app", appId) : id,
      kind,
      appId,
      targetKey: appId,
      title: normalizeDesktopEntityTitle(title, desktopSystemAppTitles[appId]),
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

  if (kind === "group_chat") {
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

  const folderId =
    typeof (value as { folderId?: unknown }).folderId === "string"
      ? ((value as { folderId?: string }).folderId ?? "")
      : targetKey;

  if (folderId === "") {
    return null;
  }

  return {
    id: id === "" ? buildDesktopEntityId(kind, folderId) : id,
    kind,
    appId: "explorer",
    folderId,
    targetKey: folderId,
    title: normalizeDesktopEntityTitle(title, "Папка"),
    visibility,
    placement,
    overflowBucket,
    order,
  };
}

function normalizeDesktopFolderMemberReference(
  input: unknown,
): DesktopFolderMemberReference | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as Partial<DesktopFolderMemberReference>;
  const id = typeof value.id === "string" ? value.id : "";
  const folderId = typeof value.folderId === "string" ? value.folderId : "";
  const target = normalizeFolderReferenceTarget(value.target);
  if (id === "" || folderId === "" || target === null) {
    return null;
  }

  return {
    id,
    folderId,
    target,
    order: readPositiveNumber(value.order, 0),
  };
}

function normalizeFolderReferenceTarget(
  input: unknown,
): DesktopFolderReferenceTarget | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = input as Partial<DesktopFolderReferenceTarget>;
  const kind =
    value.kind === "direct_chat" || value.kind === "group_chat" ? value.kind : null;
  const targetKey = typeof value.targetKey === "string" ? value.targetKey.trim() : "";
  if (kind === null || targetKey === "") {
    return null;
  }

  return {
    kind,
    targetKey,
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
    title: normalizeDesktopEntityTitle(title, desktopSystemAppTitles[appId]),
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

function buildDesktopTargetReferenceKey(target: DesktopFolderReferenceTarget): string {
  return `${target.kind}:${target.targetKey}`;
}

function normalizeDesktopEntityTitle(title: string, fallbackTitle: string): string {
  const normalizedTitle = title.trim();
  return normalizedTitle === "" ? fallbackTitle : normalizedTitle;
}

function readDesktopEntityKind(value: unknown): DesktopEntityKind | null {
  return value === "system_app" ||
    value === "direct_chat" ||
    value === "group_chat" ||
    value === "custom_folder"
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
  if (value === "contacts" || value === "groups" || value === "folders") {
    return value;
  }

  return null;
}

function readPositiveNumber(value: unknown, fallbackValue: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallbackValue;
}

function describeDefaultOverflowBucket(
  kind: Exclude<DesktopEntityKind, "system_app">,
): Exclude<DesktopOverflowBucket, null> {
  if (kind === "direct_chat") {
    return "contacts";
  }

  if (kind === "group_chat") {
    return "groups";
  }

  return "folders";
}

function describeOverflowBucket(
  bucket: Exclude<DesktopOverflowBucket, null>,
): string {
  if (bucket === "contacts") {
    return "Контакты";
  }

  if (bucket === "groups") {
    return "Группы";
  }

  return "Папки";
}
