import {
  getCustomFolderDesktopEntity,
  getCustomFolderUnreadCount,
  hasDesktopTargetUnread,
  listCustomFolderDesktopEntities,
  listCustomFolderMemberEntryRecords,
  listDesktopEntitiesForSurface,
  listDesktopOverflowEntities,
  listDesktopRegistryEntities,
  listHiddenDesktopEntities,
  type DesktopCustomFolderEntity,
  type DesktopEntity,
  type DesktopFolderMemberEntryRecord,
  type DesktopOverflowBucket,
  type DesktopRegistryState,
  type DesktopUnreadTargetMap,
} from "./desktop-registry";
import type { ShellAppId } from "./runtime";

export type ExplorerSectionId =
  | "desktop"
  | "folders"
  | "contacts"
  | "groups"
  | "hidden"
  | "overflow"
  | "requests"
  | "search"
  | "settings";

export interface ExplorerSectionDefinition {
  id: ExplorerSectionId;
  label: string;
  description: string;
}

export type ExplorerNavigationTarget =
  | {
      kind: "section";
      sectionId: ExplorerSectionId;
    }
  | {
      kind: "folder";
      folderId: string;
    };

export interface ExplorerEntityRecord {
  entry: DesktopEntity;
  typeLabel: string;
  stateLabel: string;
  accent: string;
  unreadCount: number;
  supplementalLabel: string | null;
}

export interface ExplorerFolderRecord {
  folder: DesktopCustomFolderEntity;
  memberCount: number;
  unreadCount: number;
  stateLabel: string;
  accent: string;
}

export interface ExplorerFolderMemberRecord {
  referenceId: string;
  entry: DesktopFolderMemberEntryRecord["entry"];
  typeLabel: string;
  stateLabel: string;
  accent: string;
  hasUnread: boolean;
}

export interface ExplorerAppLinkRecord {
  appId: Extract<ShellAppId, "friend_requests" | "search" | "settings">;
  title: string;
  description: string;
}

export interface ExplorerOverflowBucketRecord {
  bucket: Exclude<DesktopOverflowBucket, null>;
  title: string;
  entities: ExplorerEntityRecord[];
}

export interface ExplorerSectionViewModel {
  section: ExplorerSectionDefinition;
  entities: ExplorerEntityRecord[];
  folders: ExplorerFolderRecord[];
  buckets: ExplorerOverflowBucketRecord[];
  appLinks: ExplorerAppLinkRecord[];
  emptyTitle: string;
  emptyDescription: string;
}

export interface ExplorerFolderViewModel {
  folder: ExplorerFolderRecord;
  members: ExplorerFolderMemberRecord[];
  emptyTitle: string;
  emptyDescription: string;
}

const emptyUnreadTargetMap: DesktopUnreadTargetMap = new Map();

export const explorerSections: readonly ExplorerSectionDefinition[] = [
  {
    id: "desktop",
    label: "Рабочий стол",
    description: "Ярлыки на рабочем столе.",
  },
  {
    id: "folders",
    label: "Папки",
    description: "Ваши папки и ярлыки.",
  },
  {
    id: "contacts",
    label: "Контакты",
    description: "Личные чаты.",
  },
  {
    id: "groups",
    label: "Группы",
    description: "Группы.",
  },
  {
    id: "hidden",
    label: "Скрытые",
    description: "Скрытые ярлыки.",
  },
  {
    id: "overflow",
    label: "Переполнение",
    description: "Ярлыки, которые не поместились на экран.",
  },
  {
    id: "requests",
    label: "Заявки",
    description: "Входящие и исходящие заявки.",
  },
  {
    id: "search",
    label: "Поиск",
    description: "Поиск сообщений.",
  },
  {
    id: "settings",
    label: "Настройки",
    description: "Параметры приложения.",
  },
];

const explorerSectionById = new Map(explorerSections.map((section) => [section.id, section]));

export function resolveExplorerSection(
  value: string | null | undefined,
): ExplorerSectionId {
  if (value === null || value === undefined) {
    return "desktop";
  }

  return explorerSectionById.has(value as ExplorerSectionId)
    ? (value as ExplorerSectionId)
    : "desktop";
}

export function resolveExplorerNavigationTarget(options: {
  section: string | null | undefined;
  folder: string | null | undefined;
}): ExplorerNavigationTarget {
  const folderId = options.folder?.trim() ?? "";
  if (folderId !== "") {
    return {
      kind: "folder",
      folderId,
    };
  }

  return {
    kind: "section",
    sectionId: resolveExplorerSection(options.section),
  };
}

export function buildExplorerSectionViewModel(
  registryState: DesktopRegistryState,
  sectionId: ExplorerSectionId,
  unreadByTarget: DesktopUnreadTargetMap = emptyUnreadTargetMap,
  visibleDesktopCapacity = Number.POSITIVE_INFINITY,
): ExplorerSectionViewModel {
  const section = explorerSectionById.get(sectionId) ?? explorerSections[0]!;

  switch (sectionId) {
    case "desktop":
      return {
        section,
        entities: listDesktopEntitiesForSurface(registryState, visibleDesktopCapacity).map(
          (entry) =>
            createExplorerEntityRecord(
              registryState,
              entry,
              unreadByTarget,
              visibleDesktopCapacity,
            ),
        ),
        folders: [],
        buckets: [],
        appLinks: [],
        emptyTitle: "Рабочий стол пуст",
        emptyDescription: "Здесь появятся приложения, чаты, группы и папки.",
      };
    case "folders":
      return {
        section,
        entities: [],
        folders: listCustomFolderDesktopEntities(registryState).map((folder) =>
          createExplorerFolderRecord(
            registryState,
            folder,
            unreadByTarget,
            visibleDesktopCapacity,
          ),
        ),
        buckets: [],
        appLinks: [],
        emptyTitle: "Папок пока нет",
        emptyDescription: "Создайте папку, чтобы собрать нужные ярлыки в одном месте.",
      };
    case "contacts":
      return {
        section,
        entities: listDesktopRegistryEntities(registryState)
          .filter((entry) => entry.kind === "direct_chat")
          .map((entry) =>
            createExplorerEntityRecord(
              registryState,
              entry,
              unreadByTarget,
              visibleDesktopCapacity,
            ),
          ),
        folders: [],
        buckets: [],
        appLinks: [],
        emptyTitle: "Контактов пока нет",
        emptyDescription: "Личные чаты появятся здесь автоматически.",
      };
    case "groups":
      return {
        section,
        entities: listDesktopRegistryEntities(registryState)
          .filter((entry) => entry.kind === "group_chat")
          .map((entry) =>
            createExplorerEntityRecord(
              registryState,
              entry,
              unreadByTarget,
              visibleDesktopCapacity,
            ),
          ),
        folders: [],
        buckets: [],
        appLinks: [],
        emptyTitle: "Групп пока нет",
        emptyDescription: "Группы появятся здесь автоматически.",
      };
    case "hidden":
      return {
        section,
        entities: listHiddenDesktopEntities(registryState).map((entry) =>
          createExplorerEntityRecord(
            registryState,
            entry,
            unreadByTarget,
            visibleDesktopCapacity,
          ),
        ),
        folders: [],
        buckets: [],
        appLinks: [],
        emptyTitle: "Скрытых entrypoints нет",
        emptyDescription: "Скрытые ярлыки можно вернуть обратно на рабочий стол.",
      };
    case "overflow":
      return {
        section,
        entities: [],
        folders: [],
        buckets: (["contacts", "groups", "folders"] as const)
          .map((bucket) => ({
            bucket,
            title: describeOverflowBucketTitle(bucket),
            entities: listDesktopOverflowEntities(
              registryState,
              visibleDesktopCapacity,
              bucket,
            ).map((entry) =>
              createExplorerEntityRecord(
                registryState,
                entry,
                unreadByTarget,
                visibleDesktopCapacity,
              ),
            ),
          }))
          .filter((bucket) => bucket.entities.length > 0),
        appLinks: [],
        emptyTitle: "Переполнения нет",
        emptyDescription: "Все ярлыки помещаются на рабочем столе.",
      };
    case "requests":
      return {
        section,
        entities: [],
        folders: [],
        buckets: [],
        appLinks: [
          {
            appId: "friend_requests",
            title: "Заявки",
            description: "Открыть заявки в друзья.",
          },
        ],
        emptyTitle: "",
        emptyDescription: "",
      };
    case "search":
      return {
        section,
        entities: [],
        folders: [],
        buckets: [],
        appLinks: [
          {
            appId: "search",
            title: "Поиск",
            description: "Открыть поиск сообщений.",
          },
        ],
        emptyTitle: "",
        emptyDescription: "",
      };
    case "settings":
      return {
        section,
        entities: [],
        folders: [],
        buckets: [],
        appLinks: [
          {
            appId: "settings",
            title: "Настройки",
            description: "Открыть параметры AeroChat.",
          },
        ],
        emptyTitle: "",
        emptyDescription: "",
      };
    default:
      return {
        section: explorerSections[0]!,
        entities: listDesktopEntitiesForSurface(registryState, visibleDesktopCapacity).map(
          (entry) =>
            createExplorerEntityRecord(
              registryState,
              entry,
              unreadByTarget,
              visibleDesktopCapacity,
            ),
        ),
        folders: [],
        buckets: [],
        appLinks: [],
        emptyTitle: "Рабочий стол пуст",
        emptyDescription: "Здесь появятся приложения, чаты, группы и папки.",
      };
  }
}

export function buildExplorerFolderViewModel(
  registryState: DesktopRegistryState,
  folderId: string,
  unreadByTarget: DesktopUnreadTargetMap = emptyUnreadTargetMap,
  visibleDesktopCapacity = Number.POSITIVE_INFINITY,
): ExplorerFolderViewModel | null {
  const folder = getCustomFolderDesktopEntity(registryState, folderId);
  if (folder === null) {
    return null;
  }

  return {
    folder: createExplorerFolderRecord(
      registryState,
      folder,
      unreadByTarget,
      visibleDesktopCapacity,
    ),
    members: listCustomFolderMemberEntryRecords(registryState, folderId).map((record) =>
      createExplorerFolderMemberRecord(record, unreadByTarget),
    ),
    emptyTitle: "Папка пуста",
    emptyDescription: "Перетащите сюда чат или группу с рабочего стола.",
  };
}

function createExplorerEntityRecord(
  registryState: DesktopRegistryState,
  entry: DesktopEntity,
  unreadByTarget: DesktopUnreadTargetMap,
  visibleDesktopCapacity: number,
): ExplorerEntityRecord {
  const unreadCount =
    entry.kind === "custom_folder"
      ? getCustomFolderUnreadCount(registryState, entry.folderId, unreadByTarget)
      : 0;

  return {
    entry,
    typeLabel: describeExplorerEntityType(entry),
    stateLabel: describeExplorerEntityState(
      entry,
      isEntryOverflowedOnDesktop(registryState, entry, visibleDesktopCapacity),
    ),
    accent: describeExplorerEntityAccent(entry),
    unreadCount,
    supplementalLabel:
      entry.kind === "custom_folder"
        ? describeFolderMemberCount(
            listCustomFolderMemberEntryRecords(registryState, entry.folderId).length,
          )
        : null,
  };
}

function createExplorerFolderRecord(
  registryState: DesktopRegistryState,
  folder: DesktopCustomFolderEntity,
  unreadByTarget: DesktopUnreadTargetMap,
  visibleDesktopCapacity: number,
): ExplorerFolderRecord {
  const memberCount = listCustomFolderMemberEntryRecords(registryState, folder.folderId).length;

  return {
    folder,
    memberCount,
    unreadCount: getCustomFolderUnreadCount(registryState, folder.folderId, unreadByTarget),
    stateLabel: describeExplorerEntityState(
      folder,
      isEntryOverflowedOnDesktop(registryState, folder, visibleDesktopCapacity),
    ),
    accent: describeExplorerEntityAccent(folder),
  };
}

function createExplorerFolderMemberRecord(
  record: DesktopFolderMemberEntryRecord,
  unreadByTarget: DesktopUnreadTargetMap,
): ExplorerFolderMemberRecord {
  return {
    referenceId: record.reference.id,
    entry: record.entry,
    typeLabel: record.entry.kind === "direct_chat" ? "Личный чат" : "Группа",
    stateLabel: describeExplorerEntityState(record.entry, false),
    accent: describeExplorerEntityAccent(record.entry),
    hasUnread: hasDesktopTargetUnread(unreadByTarget, record.reference.target),
  };
}

function describeExplorerEntityType(entry: DesktopEntity): string {
  if (entry.kind === "direct_chat") {
    return "Личный чат";
  }

  if (entry.kind === "group_chat") {
    return "Группа";
  }

  if (entry.kind === "custom_folder") {
    return "Папка";
  }

  if (entry.appId === "explorer") {
    return "Explorer";
  }

  if (entry.appId === "friend_requests") {
    return "Заявки";
  }

  if (entry.appId === "search") {
    return "Поиск";
  }

  if (entry.appId === "settings") {
    return "Настройки";
  }

  return "Системное";
}

function describeExplorerEntityState(
  entry: DesktopEntity,
  isOverflowedOnDesktop: boolean,
): string {
  if (entry.visibility === "hidden") {
    return "Скрыт";
  }

  if (entry.placement === "overflow" || isOverflowedOnDesktop) {
    return `Не помещается: ${describeOverflowBucketTitle(resolveEntryOverflowBucket(entry)).toLowerCase()}`;
  }

  return "На рабочем столе";
}

function describeExplorerEntityAccent(entry: DesktopEntity): string {
  if (entry.kind === "custom_folder") {
    return "П";
  }

  if (entry.kind === "direct_chat" || entry.kind === "group_chat") {
    return entry.title.slice(0, 1).toUpperCase();
  }

  if (entry.appId === "friend_requests") {
    return "З";
  }

  if (entry.appId === "self_chat") {
    return "Я";
  }

  return entry.title.slice(0, 1).toUpperCase();
}

function describeFolderMemberCount(count: number): string {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  if (remainder100 >= 11 && remainder100 <= 14) {
    return `${count} объектов`;
  }

  if (remainder10 === 1) {
    return `${count} объект`;
  }

  if (remainder10 >= 2 && remainder10 <= 4) {
    return `${count} объекта`;
  }

  return `${count} объектов`;
}

function describeOverflowBucketTitle(
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

function resolveEntryOverflowBucket(
  entry: DesktopEntity,
): Exclude<DesktopOverflowBucket, null> {
  if (entry.kind === "direct_chat") {
    return "contacts";
  }

  if (entry.kind === "group_chat") {
    return "groups";
  }

  return "folders";
}

function isEntryOverflowedOnDesktop(
  registryState: DesktopRegistryState,
  entry: DesktopEntity,
  visibleDesktopCapacity: number,
): boolean {
  if (entry.visibility !== "visible" || entry.placement !== "desktop") {
    return false;
  }

  return listDesktopOverflowEntities(registryState, visibleDesktopCapacity).some(
    (currentEntry) => currentEntry.id === entry.id,
  );
}
