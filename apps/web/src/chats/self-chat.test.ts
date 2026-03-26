import { describe, expect, it } from "vitest";
import type { DirectChat } from "../gateway/types";
import {
  findSelfDirectChat,
  getDirectChatPeerOrSelf,
  isSelfDirectChat,
} from "./self-chat";

function createDirectChat(overrides: Partial<DirectChat> = {}): DirectChat {
  return {
    id: "chat-1",
    kind: "CHAT_KIND_DIRECT",
    participants: [
      {
        id: "user-1",
        login: "alice",
        nickname: "Alice",
        avatarUrl: null,
      },
      {
        id: "user-2",
        login: "bob",
        nickname: "Bob",
        avatarUrl: null,
      },
    ],
    pinnedMessageIds: [],
    encryptedPinnedMessageIds: [],
    unreadCount: 0,
    encryptedUnreadCount: 0,
    createdAt: "2026-03-26T09:00:00Z",
    updatedAt: "2026-03-26T09:00:00Z",
    ...overrides,
  };
}

describe("self chat helpers", () => {
  it("recognizes self chats with a single participant", () => {
    const chat = createDirectChat({
      participants: [
        {
          id: "user-1",
          login: "alice",
          nickname: "Alice",
          avatarUrl: null,
        },
      ],
    });

    expect(isSelfDirectChat(chat, "user-1")).toBe(true);
    expect(findSelfDirectChat([chat], "user-1")?.id).toBe("chat-1");
    expect(getDirectChatPeerOrSelf(chat, "user-1")?.login).toBe("alice");
  });

  it("keeps normal peer resolution for non-self chats", () => {
    const chat = createDirectChat();

    expect(isSelfDirectChat(chat, "user-1")).toBe(false);
    expect(findSelfDirectChat([chat], "user-1")).toBeNull();
    expect(getDirectChatPeerOrSelf(chat, "user-1")?.login).toBe("bob");
  });
});
