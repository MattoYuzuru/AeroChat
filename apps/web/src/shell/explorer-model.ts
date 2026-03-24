import {
  listDesktopEntitiesForSurface,
  listDesktopOverflowEntities,
  listDesktopRegistryEntities,
  listHiddenDesktopEntities,
  type DesktopEntity,
  type DesktopOverflowBucket,
  type DesktopRegistryState,
} from "./desktop-registry";
import type { ShellAppId } from "./runtime";

export type ExplorerSectionId =
  | "desktop"
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

export interface ExplorerEntityRecord {
  entry: DesktopEntity;
  typeLabel: string;
  stateLabel: string;
  accent: string;
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
  buckets: ExplorerOverflowBucketRecord[];
  appLinks: ExplorerAppLinkRecord[];
  emptyTitle: string;
  emptyDescription: string;
}

export const explorerSections: readonly ExplorerSectionDefinition[] = [
  {
    id: "desktop",
    label: "Рабочий стол",
    description: "Видимые entrypoints текущего shell-local desktop.",
  },
  {
    id: "contacts",
    label: "Контакты",
    description: "Direct chat entrypoints и их текущее shell-local состояние.",
  },
  {
    id: "groups",
    label: "Группы",
    description: "Group chat entrypoints и их текущее shell-local состояние.",
  },
  {
    id: "hidden",
    label: "Скрытые",
    description: "Entrypoints, убранные с рабочего стола без удаления объектов.",
  },
  {
    id: "overflow",
    label: "Переполнение",
    description: "Bounded overflow buckets для текущей desktop grid.",
  },
  {
    id: "requests",
    label: "Заявки",
    description: "Канонический системный entrypoint friend requests.",
  },
  {
    id: "search",
    label: "Поиск",
    description: "Отдельное Search app без смешивания privacy boundaries.",
  },
  {
    id: "settings",
    label: "Настройки",
    description: "Системный singleton для account, privacy и devices.",
  },
];

const explorerSectionById = new Map(
  explorerSections.map((section) => [section.id, section]),
);

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

export function buildExplorerSectionViewModel(
  registryState: DesktopRegistryState,
  sectionId: ExplorerSectionId,
): ExplorerSectionViewModel {
  const section = explorerSectionById.get(sectionId) ?? explorerSections[0]!;

  switch (sectionId) {
    case "desktop":
      return {
        section,
        entities: listDesktopEntitiesForSurface(registryState).map(createExplorerEntityRecord),
        buckets: [],
        appLinks: [],
        emptyTitle: "Рабочий стол пуст",
        emptyDescription:
          "Системные entrypoints всегда остаются на месте, а новые chats/groups появятся здесь при наличии места.",
      };
    case "contacts":
      return {
        section,
        entities: listDesktopRegistryEntities(registryState)
          .filter((entry) => entry.kind === "direct_chat")
          .map(createExplorerEntityRecord),
        buckets: [],
        appLinks: [],
        emptyTitle: "Контактов пока нет",
        emptyDescription:
          "Здесь появятся canonical direct chat entrypoints из shell-local desktop registry.",
      };
    case "groups":
      return {
        section,
        entities: listDesktopRegistryEntities(registryState)
          .filter((entry) => entry.kind === "group_chat")
          .map(createExplorerEntityRecord),
        buckets: [],
        appLinks: [],
        emptyTitle: "Групп пока нет",
        emptyDescription:
          "Здесь появятся canonical group chat entrypoints из shell-local desktop registry.",
      };
    case "hidden":
      return {
        section,
        entities: listHiddenDesktopEntities(registryState).map(createExplorerEntityRecord),
        buckets: [],
        appLinks: [],
        emptyTitle: "Скрытых entrypoints нет",
        emptyDescription:
          "Если убрать chat или group с рабочего стола, recovery action появится здесь.",
      };
    case "overflow":
      return {
        section,
        entities: [],
        buckets: (["contacts", "groups"] as const)
          .map((bucket) => ({
            bucket,
            title: bucket === "contacts" ? "Контакты" : "Группы",
            entities: listDesktopOverflowEntities(registryState, bucket).map(
              createExplorerEntityRecord,
            ),
          }))
          .filter((bucket) => bucket.entities.length > 0),
        appLinks: [],
        emptyTitle: "Переполнения нет",
        emptyDescription:
          "Когда desktop grid заполнится, новые chats и groups появятся здесь в bounded buckets.",
      };
    case "requests":
      return {
        section,
        entities: [],
        buckets: [],
        appLinks: [
          {
            appId: "friend_requests",
            title: "Заявки",
            description:
              "Открывает canonical singleton window для входящих и исходящих friend requests.",
          },
        ],
        emptyTitle: "",
        emptyDescription: "",
      };
    case "search":
      return {
        section,
        entities: [],
        buckets: [],
        appLinks: [
          {
            appId: "search",
            title: "Поиск",
            description:
              "Запускает отдельное Search app с честным разделением server plaintext и local encrypted search.",
          },
        ],
        emptyTitle: "",
        emptyDescription: "",
      };
    case "settings":
      return {
        section,
        entities: [],
        buckets: [],
        appLinks: [
          {
            appId: "settings",
            title: "Настройки",
            description:
              "Открывает canonical singleton surface для privacy, devices и account preferences.",
          },
        ],
        emptyTitle: "",
        emptyDescription: "",
      };
    default:
      return {
        section: explorerSections[0]!,
        entities: listDesktopEntitiesForSurface(registryState).map(createExplorerEntityRecord),
        buckets: [],
        appLinks: [],
        emptyTitle: "Рабочий стол пуст",
        emptyDescription:
          "Системные entrypoints всегда остаются на месте, а новые chats/groups появятся здесь при наличии места.",
      };
  }
}

function createExplorerEntityRecord(entry: DesktopEntity): ExplorerEntityRecord {
  return {
    entry,
    typeLabel: describeExplorerEntityType(entry),
    stateLabel: describeExplorerEntityState(entry),
    accent: describeExplorerEntityAccent(entry),
  };
}

function describeExplorerEntityType(entry: DesktopEntity): string {
  if (entry.kind === "direct_chat") {
    return "Личный чат";
  }

  if (entry.kind === "group_chat") {
    return "Группа";
  }

  if (entry.appId === "explorer") {
    return "Organizer";
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

function describeExplorerEntityState(entry: DesktopEntity): string {
  if (entry.visibility === "hidden") {
    return "Скрыт";
  }

  if (entry.placement === "overflow") {
    return entry.overflowBucket === "groups" ? "В переполнении: группы" : "В переполнении: контакты";
  }

  return "На рабочем столе";
}

function describeExplorerEntityAccent(entry: DesktopEntity): string {
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
