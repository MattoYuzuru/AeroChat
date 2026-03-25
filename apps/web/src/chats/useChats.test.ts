import { describe, expect, it } from "vitest";
import {
  createDescopedDirectThreadSnapshot,
  shouldBootstrapEncryptedDirectChatActivity,
} from "./useChats";

describe("createDescopedDirectThreadSnapshot", () => {
  it("returns an honest empty legacy thread snapshot for direct chats", () => {
    const snapshot = createDescopedDirectThreadSnapshot({
      chat: {
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
        pinnedMessageIds: ["legacy-message-1"],
        encryptedPinnedMessageIds: ["encrypted-message-1"],
        unreadCount: 4,
        encryptedUnreadCount: 1,
        createdAt: "2026-03-25T10:00:00Z",
        updatedAt: "2026-03-25T10:05:00Z",
      },
      readState: {
        selfPosition: null,
        peerPosition: null,
      },
      encryptedReadState: null,
      typingState: null,
      presenceState: null,
    });

    expect(snapshot.messages).toEqual([]);
    expect(snapshot.chat.id).toBe("chat-1");
    expect(snapshot.chat.pinnedMessageIds).toEqual(["legacy-message-1"]);
    expect(snapshot.chat.encryptedPinnedMessageIds).toEqual(["encrypted-message-1"]);
  });
});

describe("shouldBootstrapEncryptedDirectChatActivity", () => {
  it("requests a list bootstrap for first incoming encrypted direct chat", () => {
    expect(
      shouldBootstrapEncryptedDirectChatActivity(
        [
          {
            id: "chat-1",
            kind: "CHAT_KIND_DIRECT",
            participants: [],
            pinnedMessageIds: [],
            encryptedPinnedMessageIds: [],
            unreadCount: 0,
            encryptedUnreadCount: 0,
            createdAt: "2026-03-25T10:00:00Z",
            updatedAt: "2026-03-25T10:05:00Z",
          },
        ],
        "chat-2",
      ),
    ).toBe(true);
  });

  it("keeps live patch path for already known encrypted direct chat", () => {
    expect(
      shouldBootstrapEncryptedDirectChatActivity(
        [
          {
            id: "chat-1",
            kind: "CHAT_KIND_DIRECT",
            participants: [],
            pinnedMessageIds: [],
            encryptedPinnedMessageIds: [],
            unreadCount: 0,
            encryptedUnreadCount: 0,
            createdAt: "2026-03-25T10:00:00Z",
            updatedAt: "2026-03-25T10:05:00Z",
          },
        ],
        "chat-1",
      ),
    ).toBe(false);
  });
});
