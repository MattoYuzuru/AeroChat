import { describe, expect, it } from "vitest";
import type { DirectChat, Group } from "../gateway/types";
import type { ShellPreferencesStorageLike } from "./preferences";
import {
  addCustomFolderMemberReference,
  createCustomFolderDesktopEntity,
  createDesktopUnreadTargetMap,
  createInitialDesktopRegistryState,
  deleteCustomFolderDesktopEntity,
  getCustomFolderUnreadCount,
  hideDesktopEntity,
  listCustomFolderDesktopEntities,
  listCustomFolderMemberEntryRecords,
  listDesktopEntitiesForSurface,
  listDesktopOverflowSummaries,
  moveDesktopEntityToIndex,
  readDesktopRegistryState,
  renameCustomFolderDesktopEntity,
  showDesktopEntityOnDesktop,
  syncDirectChatDesktopEntities,
  syncGroupChatDesktopEntities,
  upsertDirectChatDesktopEntity,
  writeDesktopRegistryState,
} from "./desktop-registry";

class MemoryStorage implements ShellPreferencesStorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe("desktop registry", () => {
  it("always restores mandatory system apps on desktop", () => {
    const storage = new MemoryStorage();

    writeDesktopRegistryState(storage, createInitialDesktopRegistryState());

    const state = readDesktopRegistryState(storage);
    const visibleTitles = listDesktopEntitiesForSurface(state).map((entry) => entry.title);

    expect(visibleTitles).toEqual(["Я", "Поиск", "Explorer", "Заявки", "Настройки"]);
  });

  it("persists hidden direct chat state across reload", () => {
    const storage = new MemoryStorage();
    let state = createInitialDesktopRegistryState();

    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");
    const hiddenEntry = state.entries.find((entry) => entry.targetKey === "chat-1");
    state = hideDesktopEntity(state, hiddenEntry!.id);

    writeDesktopRegistryState(storage, state);
    const restoredState = readDesktopRegistryState(storage);

    expect(
      restoredState.entries.find((entry) => entry.targetKey === "chat-1")?.visibility,
    ).toBe("hidden");
    expect(
      listDesktopEntitiesForSurface(restoredState).some((entry) => entry.targetKey === "chat-1"),
    ).toBe(false);
  });

  it("auto-populates direct chats without duplicates and updates titles", () => {
    let state = createInitialDesktopRegistryState();
    const chat = createDirectChat("chat-1", "user-self", "Alice");

    state = syncDirectChatDesktopEntities(state, [chat], "user-self");
    state = syncDirectChatDesktopEntities(
      state,
      [createDirectChat("chat-1", "user-self", "Alice Cooper")],
      "user-self",
    );

    const chatEntries = state.entries.filter((entry) => entry.kind === "direct_chat");
    expect(chatEntries).toHaveLength(1);
    expect(chatEntries[0]?.title).toBe("Alice Cooper");
  });

  it("restores hidden entry back into desktop-visible organizer state without duplicates", () => {
    let state = createInitialDesktopRegistryState();

    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");
    const hiddenEntry = state.entries.find((entry) => entry.targetKey === "chat-1");
    state = hideDesktopEntity(state, hiddenEntry!.id);
    state = showDesktopEntityOnDesktop(state, hiddenEntry!.id);

    const restoredEntry = state.entries.find((entry) => entry.targetKey === "chat-1");
    expect(restoredEntry?.visibility).toBe("visible");
    expect(restoredEntry?.placement).toBe("desktop");
    expect(state.entries.filter((entry) => entry.targetKey === "chat-1")).toHaveLength(1);
  });

  it("derives overflow from the provided visible desktop capacity", () => {
    let state = createInitialDesktopRegistryState();

    for (let index = 1; index <= 12; index += 1) {
      state = upsertDirectChatDesktopEntity(state, `chat-${index}`, `Chat ${index}`);
    }
    state = syncGroupChatDesktopEntities(state, [createGroup("group-1", "Design Team")]);

    const visibleEntries = listDesktopEntitiesForSurface(state, 10);
    const overflow = listDesktopOverflowSummaries(state, 10);

    expect(visibleEntries).toHaveLength(10);
    expect(overflow).toEqual([
      { bucket: "contacts", title: "Контакты", count: 7 },
      { bucket: "groups", title: "Группы", count: 1 },
    ]);
  });

  it("can move a desktop entry to another grid index", () => {
    let state = createInitialDesktopRegistryState();

    for (let index = 1; index <= 3; index += 1) {
      state = upsertDirectChatDesktopEntity(state, `chat-${index}`, `Chat ${index}`);
    }

    state = moveDesktopEntityToIndex(state, "direct_chat:chat-3", 1);

    expect(listDesktopEntitiesForSurface(state).map((entry) => entry.id).slice(0, 4)).toEqual([
      "system_app:self_chat",
      "direct_chat:chat-3",
      "system_app:search",
      "system_app:explorer",
    ]);
  });

  it("removes stale group entries when the current source no longer returns them", () => {
    let state = createInitialDesktopRegistryState();

    state = syncGroupChatDesktopEntities(state, [
      createGroup("group-1", "Design"),
      createGroup("group-2", "Backend"),
    ]);
    state = syncGroupChatDesktopEntities(state, [createGroup("group-2", "Backend")]);

    expect(
      state.entries.some((entry) => entry.kind === "group_chat" && entry.targetKey === "group-1"),
    ).toBe(false);
    expect(
      state.entries.some((entry) => entry.kind === "group_chat" && entry.targetKey === "group-2"),
    ).toBe(true);
  });

  it("creates, renames and deletes custom folders without deleting underlying targets", () => {
    let state = createInitialDesktopRegistryState();

    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");
    state = createCustomFolderDesktopEntity(state, "Работа");
    const folder = listCustomFolderDesktopEntities(state)[0]!;

    state = addCustomFolderMemberReference(state, folder.folderId, {
      kind: "direct_chat",
      targetKey: "chat-1",
    });
    state = renameCustomFolderDesktopEntity(state, folder.folderId, "Фокус");

    expect(listCustomFolderDesktopEntities(state)[0]?.title).toBe("Фокус");

    state = deleteCustomFolderDesktopEntity(state, folder.folderId);

    expect(listCustomFolderDesktopEntities(state)).toHaveLength(0);
    expect(
      state.entries.some((entry) => entry.kind === "direct_chat" && entry.targetKey === "chat-1"),
    ).toBe(true);
  });

  it("persists custom folder membership across reload", () => {
    const storage = new MemoryStorage();
    let state = createInitialDesktopRegistryState();

    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");
    state = syncGroupChatDesktopEntities(state, [createGroup("group-1", "Design Team")]);
    state = createCustomFolderDesktopEntity(state, "Работа");
    const folder = listCustomFolderDesktopEntities(state)[0]!;

    state = addCustomFolderMemberReference(state, folder.folderId, {
      kind: "direct_chat",
      targetKey: "chat-1",
    });
    state = addCustomFolderMemberReference(state, folder.folderId, {
      kind: "group_chat",
      targetKey: "group-1",
    });

    writeDesktopRegistryState(storage, state);
    const restoredState = readDesktopRegistryState(storage);

    expect(listCustomFolderDesktopEntities(restoredState)).toHaveLength(1);
    expect(
      listCustomFolderMemberEntryRecords(restoredState, folder.folderId).map(
        (record) => record.entry.targetKey,
      ),
    ).toEqual(["chat-1", "group-1"]);
  });

  it("allows the same target to exist in multiple folders without duplicating underlying entities", () => {
    let state = createInitialDesktopRegistryState();

    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");
    state = createCustomFolderDesktopEntity(state, "Работа");
    state = createCustomFolderDesktopEntity(state, "Личное");
    const [firstFolder, secondFolder] = listCustomFolderDesktopEntities(state);

    state = addCustomFolderMemberReference(state, firstFolder!.folderId, {
      kind: "direct_chat",
      targetKey: "chat-1",
    });
    state = addCustomFolderMemberReference(state, secondFolder!.folderId, {
      kind: "direct_chat",
      targetKey: "chat-1",
    });

    expect(listCustomFolderMemberEntryRecords(state, firstFolder!.folderId)).toHaveLength(1);
    expect(listCustomFolderMemberEntryRecords(state, secondFolder!.folderId)).toHaveLength(1);
    expect(
      state.entries.filter((entry) => entry.kind === "direct_chat" && entry.targetKey === "chat-1"),
    ).toHaveLength(1);
  });

  it("prevents duplicate folder references inside the same folder", () => {
    let state = createInitialDesktopRegistryState();

    state = upsertDirectChatDesktopEntity(state, "chat-1", "Алиса");
    state = createCustomFolderDesktopEntity(state, "Работа");
    const folder = listCustomFolderDesktopEntities(state)[0]!;

    state = addCustomFolderMemberReference(state, folder.folderId, {
      kind: "direct_chat",
      targetKey: "chat-1",
    });
    state = addCustomFolderMemberReference(state, folder.folderId, {
      kind: "direct_chat",
      targetKey: "chat-1",
    });

    expect(listCustomFolderMemberEntryRecords(state, folder.folderId)).toHaveLength(1);
  });

  it("counts unread by referenced chat targets instead of summing message counters", () => {
    let state = createInitialDesktopRegistryState();

    state = syncDirectChatDesktopEntities(
      state,
      [
        createDirectChat("chat-1", "user-self", "Alice", {
          unreadCount: 3,
          encryptedUnreadCount: 0,
        }),
        createDirectChat("chat-2", "user-self", "Bob", {
          unreadCount: 0,
          encryptedUnreadCount: 0,
        }),
      ],
      "user-self",
    );
    state = syncGroupChatDesktopEntities(state, [
      createGroup("group-1", "Design Team", {
        unreadCount: 0,
        encryptedUnreadCount: 4,
      }),
    ]);
    state = createCustomFolderDesktopEntity(state, "Unread");
    const folder = listCustomFolderDesktopEntities(state)[0]!;

    state = addCustomFolderMemberReference(state, folder.folderId, {
      kind: "direct_chat",
      targetKey: "chat-1",
    });
    state = addCustomFolderMemberReference(state, folder.folderId, {
      kind: "direct_chat",
      targetKey: "chat-2",
    });
    state = addCustomFolderMemberReference(state, folder.folderId, {
      kind: "group_chat",
      targetKey: "group-1",
    });

    const unreadMap = createDesktopUnreadTargetMap(
      [
        createDirectChat("chat-1", "user-self", "Alice", {
          unreadCount: 3,
          encryptedUnreadCount: 0,
        }),
        createDirectChat("chat-2", "user-self", "Bob", {
          unreadCount: 0,
          encryptedUnreadCount: 0,
        }),
      ],
      [createGroup("group-1", "Design Team", { unreadCount: 0, encryptedUnreadCount: 4 })],
    );

    expect(getCustomFolderUnreadCount(state, folder.folderId, unreadMap)).toBe(2);
  });
});

function createDirectChat(
  id: string,
  currentUserId: string,
  peerNickname: string,
  overrides?: Partial<Pick<DirectChat, "unreadCount" | "encryptedUnreadCount">>,
): DirectChat {
  return {
    id,
    kind: "DIRECT_CHAT_KIND_PRIMARY",
    participants: [
      {
        id: currentUserId,
        login: "self",
        nickname: "Self",
        avatarUrl: null,
      },
      {
        id: `${id}-peer`,
        login: `${id}-peer`,
        nickname: peerNickname,
        avatarUrl: null,
      },
    ],
    pinnedMessageIds: [],
    encryptedPinnedMessageIds: [],
    unreadCount: overrides?.unreadCount ?? 0,
    encryptedUnreadCount: overrides?.encryptedUnreadCount ?? 0,
    createdAt: "2026-03-24T10:00:00Z",
    updatedAt: "2026-03-24T10:00:00Z",
  };
}

function createGroup(
  id: string,
  name: string,
  overrides?: Partial<Pick<Group, "unreadCount" | "encryptedUnreadCount">>,
): Group {
  return {
    id,
    name,
    kind: "GROUP_KIND_PRIMARY",
    selfRole: "member",
    memberCount: 4,
    encryptedPinnedMessageIds: [],
    unreadCount: overrides?.unreadCount ?? 0,
    encryptedUnreadCount: overrides?.encryptedUnreadCount ?? 0,
    permissions: {
      canManageInviteLinks: false,
      creatableInviteRoles: [],
      canManageMemberRoles: false,
      roleManagementTargetRoles: [],
      assignableRoles: [],
      canTransferOwnership: false,
      removableMemberRoles: [],
      restrictableMemberRoles: [],
      canLeaveGroup: true,
    },
    createdAt: "2026-03-24T10:00:00Z",
    updatedAt: "2026-03-24T10:00:00Z",
  };
}
