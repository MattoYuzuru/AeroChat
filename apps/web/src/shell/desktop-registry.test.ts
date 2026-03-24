import { describe, expect, it } from "vitest";
import type { DirectChat, Group } from "../gateway/types";
import type { ShellPreferencesStorageLike } from "./preferences";
import {
  createInitialDesktopRegistryState,
  hideDesktopEntity,
  listDesktopOverflowEntities,
  listDesktopEntitiesForSurface,
  listDesktopOverflowSummaries,
  MAX_VISIBLE_DESKTOP_ENTRIES,
  readDesktopRegistryState,
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

    writeDesktopRegistryState(storage, {
      entries: [],
      nextOrder: 1,
    });

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

  it("routes excess direct and group entities into bounded overflow buckets", () => {
    let state = createInitialDesktopRegistryState();

    for (let index = 1; index <= MAX_VISIBLE_DESKTOP_ENTRIES; index += 1) {
      state = upsertDirectChatDesktopEntity(state, `chat-${index}`, `Chat ${index}`);
    }
    state = syncGroupChatDesktopEntities(state, [createGroup("group-1", "Design Team")]);

    const visibleEntries = listDesktopEntitiesForSurface(state);
    const overflow = listDesktopOverflowSummaries(state);

    expect(visibleEntries).toHaveLength(MAX_VISIBLE_DESKTOP_ENTRIES);
    expect(overflow).toEqual([
      { bucket: "contacts", title: "Контакты", count: 5 },
      { bucket: "groups", title: "Группы", count: 1 },
    ]);
  });

  it("can promote overflow entry back to desktop while keeping bounded overflow", () => {
    let state = createInitialDesktopRegistryState();

    for (let index = 1; index <= MAX_VISIBLE_DESKTOP_ENTRIES; index += 1) {
      state = upsertDirectChatDesktopEntity(state, `chat-${index}`, `Chat ${index}`);
    }

    const overflowEntry = listDesktopOverflowEntities(state, "contacts")[0];
    state = showDesktopEntityOnDesktop(state, overflowEntry!.id);

    expect(listDesktopEntitiesForSurface(state).some((entry) => entry.id === overflowEntry!.id)).toBe(true);
    expect(listDesktopOverflowEntities(state, "contacts")).toHaveLength(5);
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
});

function createDirectChat(
  id: string,
  currentUserId: string,
  peerNickname: string,
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
    unreadCount: 0,
    encryptedUnreadCount: 0,
    createdAt: "2026-03-24T10:00:00Z",
    updatedAt: "2026-03-24T10:00:00Z",
  };
}

function createGroup(id: string, name: string): Group {
  return {
    id,
    name,
    kind: "GROUP_KIND_PRIMARY",
    selfRole: "member",
    memberCount: 4,
    encryptedPinnedMessageIds: [],
    unreadCount: 0,
    encryptedUnreadCount: 0,
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
