import { describe, expect, it, vi } from "vitest";
import { bootstrapAuthSession } from "./bootstrap";
import { GatewayError, type GatewayClient } from "../gateway/types";
import { createSessionStore, type StorageLike } from "./session-store";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function createClient(overrides: Partial<GatewayClient>): GatewayClient {
  return {
    login: vi.fn(),
    register: vi.fn(),
    logoutCurrentSession: vi.fn(),
    listDevices: vi.fn(),
    revokeSessionOrDevice: vi.fn(),
    createGroup: vi.fn(),
    listGroups: vi.fn(),
    getGroup: vi.fn(),
    getGroupChat: vi.fn(),
    createAttachmentUploadIntent: vi.fn(),
    completeAttachmentUpload: vi.fn(),
    getAttachment: vi.fn(),
    setGroupTyping: vi.fn(),
    clearGroupTyping: vi.fn(),
    listGroupMembers: vi.fn(),
    updateGroupMemberRole: vi.fn(),
    transferGroupOwnership: vi.fn(),
    removeGroupMember: vi.fn(),
    leaveGroup: vi.fn(),
    createGroupInviteLink: vi.fn(),
    listGroupInviteLinks: vi.fn(),
    disableGroupInviteLink: vi.fn(),
    joinGroupByInviteLink: vi.fn(),
    listGroupMessages: vi.fn(),
    sendGroupTextMessage: vi.fn(),
    markGroupChatRead: vi.fn(),
    createDirectChat: vi.fn(),
    listDirectChats: vi.fn(),
    getDirectChat: vi.fn(),
    markDirectChatRead: vi.fn(),
    setDirectChatTyping: vi.fn(),
    clearDirectChatTyping: vi.fn(),
    setDirectChatPresenceHeartbeat: vi.fn(),
    clearDirectChatPresence: vi.fn(),
    sendTextMessage: vi.fn(),
    listDirectChatMessages: vi.fn(),
    deleteMessageForEveryone: vi.fn(),
    pinMessage: vi.fn(),
    unpinMessage: vi.fn(),
    sendFriendRequest: vi.fn(),
    acceptFriendRequest: vi.fn(),
    declineFriendRequest: vi.fn(),
    cancelOutgoingFriendRequest: vi.fn(),
    listIncomingFriendRequests: vi.fn(),
    listOutgoingFriendRequests: vi.fn(),
    listFriends: vi.fn(),
    removeFriend: vi.fn(),
    updateCurrentProfile: vi.fn(),
    getCurrentProfile: vi.fn(),
    ...overrides,
  };
}

describe("bootstrapAuthSession", () => {
  it("returns anonymous when there is no stored token", async () => {
    const result = await bootstrapAuthSession(
      createClient({
        getCurrentProfile: vi.fn(),
      }),
      createSessionStore(new MemoryStorage()),
    );

    expect(result).toEqual({
      status: "anonymous",
      notice: null,
    });
  });

  it("hydrates authenticated session from gateway profile", async () => {
    const storage = new MemoryStorage();
    storage.setItem("aerochat.gateway.session", "token-1");
    const result = await bootstrapAuthSession(
      createClient({
        getCurrentProfile: vi.fn(async () => ({
          id: "user-1",
          login: "alice",
          nickname: "Alice",
          avatarUrl: null,
          bio: null,
          timezone: null,
          profileAccent: null,
          statusText: null,
          birthday: null,
          country: null,
          city: null,
          readReceiptsEnabled: true,
          presenceEnabled: true,
          typingVisibilityEnabled: true,
          keyBackupStatus: "KEY_BACKUP_STATUS_NOT_CONFIGURED",
          createdAt: "2026-03-23T10:00:00Z",
          updatedAt: "2026-03-23T10:00:00Z",
        })),
      }),
      createSessionStore(storage),
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: "authenticated",
        token: "token-1",
      }),
    );
  });

  it("clears invalid stored token", async () => {
    const storage = new MemoryStorage();
    storage.setItem("aerochat.gateway.session", "expired-token");
    const sessionStore = createSessionStore(storage);

    const result = await bootstrapAuthSession(
      createClient({
        getCurrentProfile: vi.fn(async () => {
          throw new GatewayError("unauthenticated", "expired", 401);
        }),
      }),
      sessionStore,
    );

    expect(result).toEqual({
      status: "anonymous",
      notice: "Сохранённая сессия истекла. Войдите снова.",
    });
    expect(sessionStore.read()).toBeNull();
  });

  it("returns recoverable bootstrap error for gateway failures", async () => {
    const storage = new MemoryStorage();
    storage.setItem("aerochat.gateway.session", "token-1");

    const result = await bootstrapAuthSession(
      createClient({
        getCurrentProfile: vi.fn(async () => {
          throw new GatewayError("unavailable", "gateway unavailable", 503);
        }),
      }),
      createSessionStore(storage),
    );

    expect(result).toEqual({
      status: "error",
      token: "token-1",
      message: "Gateway сейчас недоступен. Повторите попытку позже.",
    });
  });
});
