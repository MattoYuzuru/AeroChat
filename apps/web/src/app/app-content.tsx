import type { ReactNode } from "react";
import type { ShellAppId } from "../shell/runtime";
import { RetryableLazyModule } from "./lazy-module";
import { createLazyModule } from "./lazy-module-loader";

const modules = {
  self_chat: createLazyModule<Record<string, never>>(() => import("../pages/SelfChatPage").then(({ SelfChatPage }) => ({ default: SelfChatPage }))),
  group_creator: createLazyModule<Record<string, never>>(() => import("../pages/CreateGroupPage").then(({ CreateGroupPage }) => ({ default: CreateGroupPage }))),
  profile: createLazyModule<Record<string, never>>(() => import("../pages/ProfilePage").then(({ ProfilePage }) => ({ default: ProfilePage }))),
  friend_requests: createLazyModule<Record<string, never>>(() => import("../pages/FriendRequestsPage").then(({ FriendRequestsPage }) => ({ default: FriendRequestsPage }))),
  explorer: createLazyModule<Record<string, never>>(() => import("../pages/ExplorerPage").then(({ ExplorerPage }) => ({ default: ExplorerPage }))),
  people: createLazyModule<Record<string, never>>(() => import("../pages/PeoplePage").then(({ PeoplePage }) => ({ default: PeoplePage }))),
  person_profile: createLazyModule<Record<string, never>>(() => import("../pages/PersonProfilePage").then(({ PersonProfilePage }) => ({ default: PersonProfilePage }))),
  chats: createLazyModule<Record<string, never>>(() => import("../pages/ChatsPage").then(({ ChatsPage }) => ({ default: ChatsPage }))),
  groups: createLazyModule<Record<string, never>>(() => import("../pages/GroupsPage").then(({ GroupsPage }) => ({ default: GroupsPage }))),
  search: createLazyModule<Record<string, never>>(() => import("../pages/SearchPage").then(({ SearchPage }) => ({ default: SearchPage }))),
  settings: createLazyModule<Record<string, never>>(() => import("../pages/SettingsPage").then(({ SettingsPage }) => ({ default: SettingsPage }))),
};

export function renderShellAppContent(appId: ShellAppId): ReactNode {
  const moduleId = appId === "direct_chat" ? "chats" : appId === "group_chat" ? "groups" : appId;
  if (!(moduleId in modules)) {
    return null;
  }
  const descriptor = modules[moduleId as keyof typeof modules];
  return <RetryableLazyModule key={appId} descriptor={descriptor} title="Приложение" moduleProps={{}} />;
}
