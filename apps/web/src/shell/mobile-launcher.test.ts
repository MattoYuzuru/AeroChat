import { describe, expect, it } from "vitest";
import {
  createCustomFolderDesktopEntity,
  createDesktopUnreadTargetMap,
  createInitialDesktopRegistryState,
  upsertDirectChatDesktopEntity,
  upsertGroupChatDesktopEntity,
} from "./desktop-registry";
import { buildMobileLauncherViewModel, mobileLauncherPrimaryApps } from "./mobile-launcher";
import type { StartMenuRecentItem } from "./start-menu";

describe("buildMobileLauncherViewModel", () => {
  it("includes required canonical launcher apps for mobile home", () => {
    const viewModel = buildMobileLauncherViewModel({
      desktopRegistryState: createInitialDesktopRegistryState(),
      recentItems: [],
    });

    expect(viewModel.primaryApps.map((entry) => entry.appId)).toEqual(
      mobileLauncherPrimaryApps.map((entry) => entry.appId),
    );
    expect(viewModel.primaryApps.some((entry) => entry.appId === "settings")).toBe(true);
  });

  it("reuses recent direct and group targets through canonical route paths", () => {
    const recentItems: StartMenuRecentItem[] = [
      {
        id: "direct_chat:chat-1",
        kind: "direct_chat",
        targetKey: "chat-1",
        title: "Алиса",
        routePath: "/app/chats?chat=chat-1",
      },
      {
        id: "group_chat:group-1",
        kind: "group_chat",
        targetKey: "group-1",
        title: "Design",
        routePath: "/app/groups?group=group-1",
      },
    ];

    const viewModel = buildMobileLauncherViewModel({
      desktopRegistryState: createInitialDesktopRegistryState(),
      recentItems,
    });

    expect(viewModel.recentItems).toEqual([
      expect.objectContaining({
        id: "direct_chat:chat-1",
        routePath: "/app/chats?chat=chat-1",
        meta: "Личный чат",
      }),
      expect.objectContaining({
        id: "group_chat:group-1",
        routePath: "/app/groups?group=group-1",
        meta: "Группа",
      }),
    ]);
  });

  it("shows bounded custom folders with explorer routes and unread/member summaries", () => {
    let state = createInitialDesktopRegistryState();
    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");
    state = upsertGroupChatDesktopEntity(state, "group-1", "Design");
    state = createCustomFolderDesktopEntity(state, "Работа");
    state = createCustomFolderDesktopEntity(state, "Личное");

    const workFolder = state.entries.find(
      (entry) => entry.kind === "custom_folder" && entry.title === "Работа",
    )!;
    const unreadMap = createDesktopUnreadTargetMap(
      [
        {
          id: "chat-1",
          kind: "DIRECT_CHAT_KIND_PRIMARY",
          participants: [],
          pinnedMessageIds: [],
          encryptedPinnedMessageIds: [],
          unreadCount: 1,
          encryptedUnreadCount: 0,
          createdAt: "2026-03-24T10:00:00Z",
          updatedAt: "2026-03-24T10:00:00Z",
        },
      ],
      [],
    );

    state = {
      ...state,
      folderMembers: [
        {
          id: "folder-member-1",
          folderId: workFolder.targetKey,
          target: {
            kind: "direct_chat",
            targetKey: "chat-1",
          },
          order: 1,
        },
        {
          id: "folder-member-2",
          folderId: workFolder.targetKey,
          target: {
            kind: "group_chat",
            targetKey: "group-1",
          },
          order: 2,
        },
      ],
    };

    const viewModel = buildMobileLauncherViewModel({
      desktopRegistryState: state,
      recentItems: [],
      unreadTargetMap: unreadMap,
    });

    const workFolderEntry = viewModel.folders.find(
      (entry) => entry.folderId === workFolder.targetKey,
    );

    expect(workFolderEntry).toEqual(
      expect.objectContaining({
        folderId: workFolder.targetKey,
        memberCount: 2,
        unreadCount: 1,
        routePath: `/app/explorer?folder=${workFolder.targetKey}`,
      }),
    );
  });
});
