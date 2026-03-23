import { describe, expect, it } from "vitest";
import type { DirectChat } from "../gateway/types";
import {
  createInitialDirectCallAwarenessState,
  directCallAwarenessReducer,
  selectVisibleDirectCallSurfaceEntry,
} from "./awareness";

const directChatOne: DirectChat = {
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
  createdAt: "2026-03-23T10:00:00Z",
  updatedAt: "2026-03-23T10:05:00Z",
};

const directChatTwo: DirectChat = {
  ...directChatOne,
  id: "chat-2",
  participants: [
    {
      id: "user-1",
      login: "alice",
      nickname: "Alice",
      avatarUrl: null,
    },
    {
      id: "user-3",
      login: "carol",
      nickname: "Carol",
      avatarUrl: null,
    },
  ],
  updatedAt: "2026-03-23T10:08:00Z",
};

describe("directCallAwarenessReducer", () => {
  it("preserves dismissal only for the same still-active call", () => {
    const stateWithDismissedSurface = directCallAwarenessReducer(
      createInitialDirectCallAwarenessState(),
      {
        type: "full_sync_succeeded",
        chats: [directChatOne],
        activeEntries: [
          {
            chat: directChatOne,
            call: {
              id: "call-1",
              scope: {
                kind: "direct",
                directChatId: "chat-1",
                groupId: null,
              },
              createdByUserId: "user-1",
              status: "active",
              activeParticipantCount: 1,
              createdAt: "2026-03-23T10:05:00Z",
              updatedAt: "2026-03-23T10:05:00Z",
              startedAt: "2026-03-23T10:05:00Z",
              endedAt: null,
              endedByUserId: null,
              endReason: "unspecified",
            },
            participants: [],
            syncStatus: "ready",
            errorMessage: null,
          },
        ],
      },
    );
    const dismissedState = directCallAwarenessReducer(stateWithDismissedSurface, {
      type: "surface_dismissed",
      chatId: "chat-1",
      callId: "call-1",
    });

    const sameCallState = directCallAwarenessReducer(dismissedState, {
      type: "chat_sync_succeeded",
      chat: directChatOne,
      chatId: "chat-1",
      call: {
        id: "call-1",
        scope: {
          kind: "direct",
          directChatId: "chat-1",
          groupId: null,
        },
        createdByUserId: "user-1",
        status: "active",
        activeParticipantCount: 2,
        createdAt: "2026-03-23T10:05:00Z",
        updatedAt: "2026-03-23T10:06:00Z",
        startedAt: "2026-03-23T10:05:00Z",
        endedAt: null,
        endedByUserId: null,
        endReason: "unspecified",
      },
      participants: [],
    });
    const nextCallState = directCallAwarenessReducer(dismissedState, {
      type: "chat_sync_succeeded",
      chat: directChatOne,
      chatId: "chat-1",
      call: {
        id: "call-2",
        scope: {
          kind: "direct",
          directChatId: "chat-1",
          groupId: null,
        },
        createdByUserId: "user-2",
        status: "active",
        activeParticipantCount: 1,
        createdAt: "2026-03-23T10:07:00Z",
        updatedAt: "2026-03-23T10:07:00Z",
        startedAt: "2026-03-23T10:07:00Z",
        endedAt: null,
        endedByUserId: null,
        endReason: "unspecified",
      },
      participants: [],
    });

    expect(sameCallState.dismissedCallIdsByChatId["chat-1"]).toBe("call-1");
    expect(nextCallState.dismissedCallIdsByChatId["chat-1"]).toBeUndefined();
  });

  it("selects the latest undismissed active direct call outside current chat", () => {
    const awarenessState = directCallAwarenessReducer(
      createInitialDirectCallAwarenessState(),
      {
        type: "full_sync_succeeded",
        chats: [directChatOne, directChatTwo],
        activeEntries: [
          {
            chat: directChatOne,
            call: {
              id: "call-1",
              scope: {
                kind: "direct",
                directChatId: "chat-1",
                groupId: null,
              },
              createdByUserId: "user-1",
              status: "active",
              activeParticipantCount: 1,
              createdAt: "2026-03-23T10:05:00Z",
              updatedAt: "2026-03-23T10:05:00Z",
              startedAt: "2026-03-23T10:05:00Z",
              endedAt: null,
              endedByUserId: null,
              endReason: "unspecified",
            },
            participants: [],
            syncStatus: "ready",
            errorMessage: null,
          },
          {
            chat: directChatTwo,
            call: {
              id: "call-2",
              scope: {
                kind: "direct",
                directChatId: "chat-2",
                groupId: null,
              },
              createdByUserId: "user-3",
              status: "active",
              activeParticipantCount: 2,
              createdAt: "2026-03-23T10:08:00Z",
              updatedAt: "2026-03-23T10:09:00Z",
              startedAt: "2026-03-23T10:08:00Z",
              endedAt: null,
              endedByUserId: null,
              endReason: "unspecified",
            },
            participants: [],
            syncStatus: "ready",
            errorMessage: null,
          },
        ],
      },
    );
    const dismissedState = directCallAwarenessReducer(awarenessState, {
      type: "surface_dismissed",
      chatId: "chat-2",
      callId: "call-2",
    });

    expect(selectVisibleDirectCallSurfaceEntry(awarenessState, null)?.chat.id).toBe("chat-2");
    expect(selectVisibleDirectCallSurfaceEntry(awarenessState, "chat-2")?.chat.id).toBe("chat-1");
    expect(selectVisibleDirectCallSurfaceEntry(dismissedState, null)?.chat.id).toBe("chat-1");
  });
});
