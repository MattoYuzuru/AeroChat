import type { ReactNode } from "react";
import { ChatsPage } from "../pages/ChatsPage";
import { GroupsPage } from "../pages/GroupsPage";
import { PeoplePage } from "../pages/PeoplePage";
import { ProfilePage } from "../pages/ProfilePage";
import { SearchPage } from "../pages/SearchPage";
import { SettingsPage } from "../pages/SettingsPage";
import type { ShellAppDefinition, ShellAppId } from "../shell/runtime";

export interface RouteBackedShellApp extends ShellAppDefinition {
  path: string;
  shortcutLabel: string;
  shortcutMeta: string;
  render(): ReactNode;
}

export const routeBackedShellApps: RouteBackedShellApp[] = [
  {
    appId: "profile",
    title: "Профиль",
    launchPolicy: "singleton",
    routePath: "/app/profile",
    path: "/app/profile",
    shortcutLabel: "Профиль",
    shortcutMeta: "identity",
    render: () => <ProfilePage />,
  },
  {
    appId: "people",
    title: "Люди",
    launchPolicy: "singleton",
    routePath: "/app/people",
    path: "/app/people",
    shortcutLabel: "Люди",
    shortcutMeta: "social",
    render: () => <PeoplePage />,
  },
  {
    appId: "chats",
    title: "Чаты",
    launchPolicy: "singleton",
    routePath: "/app/chats",
    path: "/app/chats",
    shortcutLabel: "Чаты",
    shortcutMeta: "chat opener",
    render: () => <ChatsPage />,
  },
  {
    appId: "groups",
    title: "Группы",
    launchPolicy: "singleton",
    routePath: "/app/groups",
    path: "/app/groups",
    shortcutLabel: "Группы",
    shortcutMeta: "group chat",
    render: () => <GroupsPage />,
  },
  {
    appId: "search",
    title: "Поиск",
    launchPolicy: "singleton",
    routePath: "/app/search",
    path: "/app/search",
    shortcutLabel: "Поиск",
    shortcutMeta: "message search",
    render: () => <SearchPage />,
  },
  {
    appId: "settings",
    title: "Настройки",
    launchPolicy: "singleton",
    routePath: "/app/settings",
    path: "/app/settings",
    shortcutLabel: "Настройки",
    shortcutMeta: "privacy",
    render: () => <SettingsPage />,
  },
];

export const shellAppRegistry: Record<ShellAppId, ShellAppDefinition> = {
  self_chat: {
    appId: "self_chat",
    title: "Я",
    launchPolicy: "singleton",
    routePath: null,
  },
  friend_requests: {
    appId: "friend_requests",
    title: "Заявки",
    launchPolicy: "singleton",
    routePath: null,
  },
  profile: routeBackedShellApps.find((app) => app.appId === "profile")!,
  people: routeBackedShellApps.find((app) => app.appId === "people")!,
  chats: routeBackedShellApps.find((app) => app.appId === "chats")!,
  groups: routeBackedShellApps.find((app) => app.appId === "groups")!,
  search: routeBackedShellApps.find((app) => app.appId === "search")!,
  settings: routeBackedShellApps.find((app) => app.appId === "settings")!,
};

export function resolveRouteBackedShellApp(
  pathname: string,
): RouteBackedShellApp | null {
  return routeBackedShellApps.find((app) => app.path === pathname) ?? null;
}

export function isRouteBackedShellAppId(appId: ShellAppId): boolean {
  return routeBackedShellApps.some((app) => app.appId === appId);
}

export function renderShellAppContent(appId: ShellAppId): ReactNode {
  const routeBacked = routeBackedShellApps.find((app) => app.appId === appId);
  if (routeBacked) {
    return routeBacked.render();
  }

  return null;
}
