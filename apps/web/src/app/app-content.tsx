import type { ReactNode } from "react";
import type { ShellAppId } from "../shell/runtime";
import { RetryableLazyModule } from "./lazy-module";
import { createLazyModule } from "./lazy-module-loader";

import SelfChatPageResource from "virtual:aerochat-lazy-url/SelfChatPage";
import CreateGroupPageResource from "virtual:aerochat-lazy-url/CreateGroupPage";
import ProfilePageResource from "virtual:aerochat-lazy-url/ProfilePage";
import FriendRequestsPageResource from "virtual:aerochat-lazy-url/FriendRequestsPage";
import ExplorerPageResource from "virtual:aerochat-lazy-url/ExplorerPage";
import PeoplePageResource from "virtual:aerochat-lazy-url/PeoplePage";
import PersonProfilePageResource from "virtual:aerochat-lazy-url/PersonProfilePage";
import ChatsPageResource from "virtual:aerochat-lazy-url/ChatsPage";
import GroupsPageResource from "virtual:aerochat-lazy-url/GroupsPage";
import SearchPageResource from "virtual:aerochat-lazy-url/SearchPage";
import SettingsPageResource from "virtual:aerochat-lazy-url/SettingsPage";

const modules = {
  self_chat: createLazyModule<Record<string, never>>(() => import("../pages/SelfChatPage").then(({ SelfChatPage }) => ({ default: SelfChatPage })), SelfChatPageResource, "SelfChatPage"),
  group_creator: createLazyModule<Record<string, never>>(() => import("../pages/CreateGroupPage").then(({ CreateGroupPage }) => ({ default: CreateGroupPage })), CreateGroupPageResource, "CreateGroupPage"),
  profile: createLazyModule<Record<string, never>>(() => import("../pages/ProfilePage").then(({ ProfilePage }) => ({ default: ProfilePage })), ProfilePageResource, "ProfilePage"),
  friend_requests: createLazyModule<Record<string, never>>(() => import("../pages/FriendRequestsPage").then(({ FriendRequestsPage }) => ({ default: FriendRequestsPage })), FriendRequestsPageResource, "FriendRequestsPage"),
  explorer: createLazyModule<Record<string, never>>(() => import("../pages/ExplorerPage").then(({ ExplorerPage }) => ({ default: ExplorerPage })), ExplorerPageResource, "ExplorerPage"),
  people: createLazyModule<Record<string, never>>(() => import("../pages/PeoplePage").then(({ PeoplePage }) => ({ default: PeoplePage })), PeoplePageResource, "PeoplePage"),
  person_profile: createLazyModule<Record<string, never>>(() => import("../pages/PersonProfilePage").then(({ PersonProfilePage }) => ({ default: PersonProfilePage })), PersonProfilePageResource, "PersonProfilePage"),
  chats: createLazyModule<Record<string, never>>(() => import("../pages/ChatsPage").then(({ ChatsPage }) => ({ default: ChatsPage })), ChatsPageResource, "ChatsPage"),
  groups: createLazyModule<Record<string, never>>(() => import("../pages/GroupsPage").then(({ GroupsPage }) => ({ default: GroupsPage })), GroupsPageResource, "GroupsPage"),
  search: createLazyModule<Record<string, never>>(() => import("../pages/SearchPage").then(({ SearchPage }) => ({ default: SearchPage })), SearchPageResource, "SearchPage"),
  settings: createLazyModule<Record<string, never>>(() => import("../pages/SettingsPage").then(({ SettingsPage }) => ({ default: SettingsPage })), SettingsPageResource, "SettingsPage"),
};

export function renderShellAppContent(appId: ShellAppId): ReactNode {
  const moduleId = appId === "direct_chat" ? "chats" : appId === "group_chat" ? "groups" : appId;
  if (!(moduleId in modules)) {
    return null;
  }
  const descriptor = modules[moduleId as keyof typeof modules];
  return <RetryableLazyModule key={appId} descriptor={descriptor} title="Приложение" moduleProps={{}} />;
}
