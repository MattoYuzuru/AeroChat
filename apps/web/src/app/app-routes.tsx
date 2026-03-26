import type { ReactNode } from "react";
import { CreateGroupPage } from "../pages/CreateGroupPage";
import { ChatsPage } from "../pages/ChatsPage";
import { ExplorerPage } from "../pages/ExplorerPage";
import { FriendRequestsPage } from "../pages/FriendRequestsPage";
import { GroupsPage } from "../pages/GroupsPage";
import { PeoplePage } from "../pages/PeoplePage";
import { PersonProfilePage } from "../pages/PersonProfilePage";
import { ProfilePage } from "../pages/ProfilePage";
import { SearchPage } from "../pages/SearchPage";
import { SelfChatPage } from "../pages/SelfChatPage";
import { SettingsPage } from "../pages/SettingsPage";
import type {
  ShellAppDefinition,
  ShellAppId,
  ShellLaunchTarget,
} from "../shell/runtime";

export interface RouteBackedShellApp extends ShellAppDefinition {
  path: string;
  shortcutLabel: string;
  shortcutMeta: string;
}

export interface ResolvedShellRouteEntry {
  app: ShellAppDefinition;
  target: ShellLaunchTarget | null;
}

export const routeBackedShellApps: RouteBackedShellApp[] = [
  {
    appId: "self_chat",
    title: "Я",
    launchPolicy: "singleton",
    routePath: "/app/self",
    path: "/app/self",
    shortcutLabel: "Я",
    shortcutMeta: "Личное пространство",
  },
  {
    appId: "group_creator",
    title: "Создать группу",
    launchPolicy: "singleton",
    routePath: "/app/group-creator",
    path: "/app/group-creator",
    shortcutLabel: "Создать группу",
    shortcutMeta: "Новая группа",
  },
  {
    appId: "profile",
    title: "Профиль",
    launchPolicy: "singleton",
    routePath: "/app/profile",
    path: "/app/profile",
    shortcutLabel: "Профиль",
    shortcutMeta: "Учётная запись",
  },
  {
    appId: "friend_requests",
    title: "Заявки",
    launchPolicy: "singleton",
    routePath: "/app/friend-requests",
    path: "/app/friend-requests",
    shortcutLabel: "Заявки",
    shortcutMeta: "Запросы",
  },
  {
    appId: "people",
    title: "Люди",
    launchPolicy: "singleton",
    routePath: "/app/people",
    path: "/app/people",
    shortcutLabel: "Люди",
    shortcutMeta: "Контакты",
  },
  {
    appId: "chats",
    title: "Чаты",
    launchPolicy: "singleton",
    routePath: "/app/chats",
    path: "/app/chats",
    shortcutLabel: "Чаты",
    shortcutMeta: "Личные переписки",
  },
  {
    appId: "groups",
    title: "Группы",
    launchPolicy: "singleton",
    routePath: "/app/groups",
    path: "/app/groups",
    shortcutLabel: "Группы",
    shortcutMeta: "Групповые переписки",
  },
  {
    appId: "explorer",
    title: "Проводник",
    launchPolicy: "singleton",
    routePath: "/app/explorer",
    path: "/app/explorer",
    shortcutLabel: "Проводник",
    shortcutMeta: "навигация",
  },
  {
    appId: "search",
    title: "Поиск",
    launchPolicy: "singleton",
    routePath: "/app/search",
    path: "/app/search",
    shortcutLabel: "Поиск",
    shortcutMeta: "Сообщения и люди",
  },
  {
    appId: "settings",
    title: "Настройки",
    launchPolicy: "singleton",
    routePath: "/app/settings",
    path: "/app/settings",
    shortcutLabel: "Настройки",
    shortcutMeta: "Параметры",
  },
];

export const shellAppRegistry: Record<ShellAppId, ShellAppDefinition> = {
  self_chat: routeBackedShellApps.find((app) => app.appId === "self_chat")!,
  group_creator: routeBackedShellApps.find((app) => app.appId === "group_creator")!,
  friend_requests: routeBackedShellApps.find((app) => app.appId === "friend_requests")!,
  explorer: routeBackedShellApps.find((app) => app.appId === "explorer")!,
  profile: routeBackedShellApps.find((app) => app.appId === "profile")!,
  people: routeBackedShellApps.find((app) => app.appId === "people")!,
  person_profile: {
    appId: "person_profile",
    title: "Профиль контакта",
    launchPolicy: "singleton_per_target",
    routePath: "/app/people",
  },
  chats: routeBackedShellApps.find((app) => app.appId === "chats")!,
  direct_chat: {
    appId: "direct_chat",
    title: "Личный чат",
    launchPolicy: "singleton_per_target",
    routePath: "/app/chats",
  },
  groups: routeBackedShellApps.find((app) => app.appId === "groups")!,
  group_chat: {
    appId: "group_chat",
    title: "Группа",
    launchPolicy: "singleton_per_target",
    routePath: "/app/groups",
  },
  search: routeBackedShellApps.find((app) => app.appId === "search")!,
  settings: routeBackedShellApps.find((app) => app.appId === "settings")!,
};

export function buildDirectChatRoutePath(
  chatId: string,
  searchParams?: URLSearchParams | null,
): string {
  const params = new URLSearchParams(searchParams ?? undefined);
  params.set("chat", chatId);
  return buildRoutePath("/app/chats", params);
}

export function buildSelfChatRoutePath(
  searchParams?: URLSearchParams | null,
): string {
  const params = new URLSearchParams(searchParams ?? undefined);
  return buildRoutePath("/app/self", params);
}

export function buildFriendRequestsRoutePath(
  searchParams?: URLSearchParams | null,
): string {
  const params = new URLSearchParams(searchParams ?? undefined);
  return buildRoutePath("/app/friend-requests", params);
}

export function buildExplorerRoutePath(
  searchParams?: URLSearchParams | null,
): string {
  const params = new URLSearchParams(searchParams ?? undefined);
  return buildRoutePath("/app/explorer", params);
}

export function buildExplorerFolderRoutePath(
  folderId: string,
  searchParams?: URLSearchParams | null,
): string {
  const params = new URLSearchParams(searchParams ?? undefined);
  params.delete("section");
  params.set("folder", folderId);
  return buildExplorerRoutePath(params);
}

export function buildPersonProfileRoutePath(
  userId: string,
  searchParams?: URLSearchParams | null,
): string {
  const params = new URLSearchParams(searchParams ?? undefined);
  params.set("person", userId);
  return buildRoutePath("/app/people", params);
}

export function buildGroupChatRoutePath(
  groupId: string,
  searchParams?: URLSearchParams | null,
): string {
  const params = new URLSearchParams(searchParams ?? undefined);
  params.set("group", groupId);
  return buildRoutePath("/app/groups", params);
}

export function buildDirectChatShellTarget({
  chatId,
  searchParams,
  title,
}: {
  chatId: string;
  searchParams?: URLSearchParams | null;
  title?: string;
}): ShellLaunchTarget {
  return {
    key: chatId,
    title: normalizeShellTargetTitle(title, "Личный чат"),
    routePath: buildDirectChatRoutePath(chatId, searchParams),
  };
}

export function buildPersonProfileShellTarget({
  userId,
  searchParams,
  title,
}: {
  userId: string;
  searchParams?: URLSearchParams | null;
  title?: string;
}): ShellLaunchTarget {
  return {
    key: userId,
    title: normalizeShellTargetTitle(title, "Профиль контакта"),
    routePath: buildPersonProfileRoutePath(userId, searchParams),
  };
}

export function buildGroupChatShellTarget({
  groupId,
  searchParams,
  title,
}: {
  groupId: string;
  searchParams?: URLSearchParams | null;
  title?: string;
}): ShellLaunchTarget {
  return {
    key: groupId,
    title: normalizeShellTargetTitle(title, "Группа"),
    routePath: buildGroupChatRoutePath(groupId, searchParams),
  };
}

export function resolveShellRouteEntry(
  pathname: string,
  search: string,
): ResolvedShellRouteEntry | null {
  const routeBackedApp = routeBackedShellApps.find((app) => app.path === pathname) ?? null;
  if (routeBackedApp === null) {
    return null;
  }

  const searchParams = new URLSearchParams(search);
  const requestedChatId = searchParams.get("chat")?.trim() ?? "";
  const requestedGroupId = searchParams.get("group")?.trim() ?? "";
  const requestedPersonId = searchParams.get("person")?.trim() ?? "";

  if (pathname === "/app/people" && requestedPersonId !== "") {
    return {
      app: shellAppRegistry.person_profile,
      target: buildPersonProfileShellTarget({
        userId: requestedPersonId,
        searchParams,
      }),
    };
  }

  if (pathname === "/app/chats" && requestedChatId !== "") {
    return {
      app: shellAppRegistry.direct_chat,
      target: buildDirectChatShellTarget({
        chatId: requestedChatId,
        searchParams,
      }),
    };
  }

  if (pathname === "/app/groups" && requestedGroupId !== "") {
    return {
      app: shellAppRegistry.group_chat,
      target: buildGroupChatShellTarget({
        groupId: requestedGroupId,
        searchParams,
      }),
    };
  }

  return {
    app: routeBackedApp,
    target: {
      key: routeBackedApp.appId,
      title: routeBackedApp.title,
      routePath: buildRoutePath(pathname, searchParams),
    },
  };
}

export function isRouteBackedShellAppId(appId: ShellAppId): boolean {
  return (
    routeBackedShellApps.some((app) => app.appId === appId) ||
    appId === "person_profile" ||
    appId === "direct_chat" ||
    appId === "group_chat"
  );
}

export function renderShellAppContent(appId: ShellAppId): ReactNode {
  switch (appId) {
    case "self_chat":
      return <SelfChatPage />;
    case "group_creator":
      return <CreateGroupPage />;
    case "profile":
      return <ProfilePage />;
    case "friend_requests":
      return <FriendRequestsPage />;
    case "explorer":
      return <ExplorerPage />;
    case "people":
      return <PeoplePage />;
    case "person_profile":
      return <PersonProfilePage />;
    case "chats":
    case "direct_chat":
      return <ChatsPage />;
    case "groups":
    case "group_chat":
      return <GroupsPage />;
    case "search":
      return <SearchPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return null;
  }
}

function buildRoutePath(pathname: string, searchParams: URLSearchParams): string {
  const nextSearch = searchParams.toString();
  return nextSearch === "" ? pathname : `${pathname}?${nextSearch}`;
}

function normalizeShellTargetTitle(title: string | undefined, fallbackTitle: string): string {
  const normalizedTitle = title?.trim() ?? "";
  return normalizedTitle === "" ? fallbackTitle : normalizedTitle;
}
