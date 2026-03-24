import { buildExplorerFolderRoutePath, shellAppRegistry } from "../app/app-routes";
import {
  getCustomFolderUnreadCount,
  listCustomFolderDesktopEntities,
  listCustomFolderMemberReferences,
  type DesktopRegistryState,
  type DesktopUnreadTargetMap,
} from "./desktop-registry";
import {
  MAX_START_MENU_FOLDER_ITEMS,
  resolveStartMenuRecentItemRoutePath,
  type StartMenuRecentItem,
} from "./start-menu";

export const mobileLauncherPrimaryApps = [
  {
    appId: "self_chat",
    badge: "Я",
    title: "Я",
    description: "Self workspace",
  },
  {
    appId: "chats",
    badge: "Ч",
    title: "Чаты",
    description: "Direct surfaces",
  },
  {
    appId: "groups",
    badge: "Г",
    title: "Группы",
    description: "Group surfaces",
  },
  {
    appId: "search",
    badge: "По",
    title: "Поиск",
    description: "Search app",
  },
  {
    appId: "explorer",
    badge: "Ex",
    title: "Explorer",
    description: "Folders и collections",
  },
  {
    appId: "friend_requests",
    badge: "З",
    title: "Заявки",
    description: "Friend requests",
  },
  {
    appId: "settings",
    badge: "Н",
    title: "Настройки",
    description: "Privacy и sessions",
  },
] as const;

export interface MobileLauncherPrimaryAppEntry {
  appId: (typeof mobileLauncherPrimaryApps)[number]["appId"];
  badge: string;
  description: string;
  routePath: string;
  title: string;
}

export interface MobileLauncherRecentEntry {
  id: string;
  badge: string;
  kind: StartMenuRecentItem["kind"];
  meta: string;
  routePath: string | null;
  title: string;
}

export interface MobileLauncherFolderEntry {
  folderId: string;
  memberCount: number;
  routePath: string;
  title: string;
  unreadCount: number;
}

export interface MobileLauncherViewModel {
  primaryApps: MobileLauncherPrimaryAppEntry[];
  recentItems: MobileLauncherRecentEntry[];
  folders: MobileLauncherFolderEntry[];
  hiddenFolderCount: number;
}

export function buildMobileLauncherViewModel(input: {
  desktopRegistryState: DesktopRegistryState;
  recentItems: StartMenuRecentItem[];
  unreadTargetMap?: DesktopUnreadTargetMap;
}): MobileLauncherViewModel {
  const primaryApps: MobileLauncherPrimaryAppEntry[] = mobileLauncherPrimaryApps.map((item) => ({
    ...item,
    routePath: shellAppRegistry[item.appId].routePath ?? "/app",
  }));

  const allFolders = listCustomFolderDesktopEntities(input.desktopRegistryState);
  const folders = allFolders.slice(0, MAX_START_MENU_FOLDER_ITEMS).map((folder) => ({
    folderId: folder.folderId,
    title: folder.title,
    memberCount: listCustomFolderMemberReferences(input.desktopRegistryState, folder.folderId).length,
    unreadCount:
      input.unreadTargetMap === undefined
        ? 0
        : getCustomFolderUnreadCount(
            input.desktopRegistryState,
            folder.folderId,
            input.unreadTargetMap,
          ),
    routePath: buildExplorerFolderRoutePath(folder.folderId),
  }));

  return {
    primaryApps,
    recentItems: input.recentItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      meta: describeMobileRecentMeta(item),
      badge: describeMobileRecentBadge(item),
      routePath: resolveStartMenuRecentItemRoutePath(item),
    })),
    folders,
    hiddenFolderCount: Math.max(0, allFolders.length - folders.length),
  };
}

function describeMobileRecentMeta(item: StartMenuRecentItem): string {
  if (item.kind === "direct_chat") {
    return "Личный чат";
  }

  if (item.kind === "group_chat") {
    return "Группа";
  }

  return "Приложение";
}

function describeMobileRecentBadge(item: StartMenuRecentItem): string {
  if (item.kind === "direct_chat") {
    return "ЛЧ";
  }

  if (item.kind === "group_chat") {
    return "ГР";
  }

  const primaryEntry = mobileLauncherPrimaryApps.find((entry) => entry.appId === item.appId);
  return primaryEntry?.badge ?? "A";
}
