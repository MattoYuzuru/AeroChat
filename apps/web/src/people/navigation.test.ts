import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayError, type DirectChat } from "../gateway/types";
import { gatewayClient } from "../gateway/runtime";
import {
  buildDirectChatNavigationIntent,
  buildPersonProfileNavigationIntent,
  ensureDirectChatForPeer,
} from "./navigation";

vi.mock("../gateway/runtime", () => ({
  gatewayClient: {
    listDirectChats: vi.fn(),
    createDirectChat: vi.fn(),
  },
}));

describe("person surface navigation", () => {
  it("opens request items in the canonical person_profile target with source context", () => {
    const intent = buildPersonProfileNavigationIntent({
      userId: "user-7",
      title: "Alice",
      source: "requests",
    });

    expect(intent.routePath).toBe("/app/people?from=requests&person=user-7");
    expect(intent.shellOptions.userId).toBe("user-7");
    expect(intent.shellOptions.title).toBe("Alice");
    expect(intent.shellOptions.searchParams?.toString()).toBe("from=requests");
  });

  it("keeps search profile handoff on the same canonical person target", () => {
    const intent = buildPersonProfileNavigationIntent({
      userId: "user-9",
      title: "Bob",
      source: "search",
    });

    expect(intent.routePath).toBe("/app/people?from=search&person=user-9");
    expect(intent.shellOptions.searchParams?.toString()).toBe("from=search");
  });

  it("opens chat handoff on the canonical direct_chat target", () => {
    const intent = buildDirectChatNavigationIntent({
      chatId: "chat-3",
      title: "Alice",
    });

    expect(intent.routePath).toBe("/app/chats?chat=chat-3");
    expect(intent.shellOptions.chatId).toBe("chat-3");
    expect(intent.shellOptions.title).toBe("Alice");
  });
});

describe("ensureDirectChatForPeer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses an existing direct chat before creating a new one", async () => {
    vi.mocked(gatewayClient.listDirectChats).mockResolvedValue([createDirectChat("chat-1")]);

    const chat = await ensureDirectChatForPeer("token-1", "user-2");

    expect(chat.id).toBe("chat-1");
    expect(gatewayClient.createDirectChat).not.toHaveBeenCalled();
  });

  it("creates a direct chat when none exists yet", async () => {
    vi.mocked(gatewayClient.listDirectChats).mockResolvedValue([]);
    vi.mocked(gatewayClient.createDirectChat).mockResolvedValue(createDirectChat("chat-9"));

    const chat = await ensureDirectChatForPeer("token-1", "user-2");

    expect(chat.id).toBe("chat-9");
    expect(gatewayClient.createDirectChat).toHaveBeenCalledWith("token-1", "user-2");
  });

  it("recovers from already_exists race and reuses the canonical chat", async () => {
    vi.mocked(gatewayClient.listDirectChats)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createDirectChat("chat-4")]);
    vi.mocked(gatewayClient.createDirectChat).mockRejectedValue(
      new GatewayError("already_exists", "already exists", 409),
    );

    const chat = await ensureDirectChatForPeer("token-1", "user-2");

    expect(chat.id).toBe("chat-4");
    expect(gatewayClient.listDirectChats).toHaveBeenCalledTimes(2);
  });
});

function createDirectChat(id: string): DirectChat {
  return {
    id,
    kind: "direct",
    participants: [
      {
        id: "user-self",
        login: "self",
        nickname: "Self",
        avatarUrl: null,
      },
      {
        id: "user-2",
        login: "alice",
        nickname: "Alice",
        avatarUrl: null,
      },
    ],
    pinnedMessageIds: [],
    encryptedPinnedMessageIds: [],
    unreadCount: 0,
    encryptedUnreadCount: 0,
    createdAt: "2026-03-25T10:00:00Z",
    updatedAt: "2026-03-25T10:00:00Z",
  };
}
