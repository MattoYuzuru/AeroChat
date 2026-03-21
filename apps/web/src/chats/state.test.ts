import { describe, expect, it } from "vitest";
import {
  chatsReducer,
  createInitialChatsState,
  type ChatThreadSnapshot,
} from "./state";

const directChat = {
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
  unreadCount: 0,
  createdAt: "2026-03-25T10:00:00Z",
  updatedAt: "2026-03-25T10:10:00Z",
};

const threadSnapshot: ChatThreadSnapshot = {
  chat: directChat,
  messages: [
    {
      id: "message-1",
      chatId: "chat-1",
      senderUserId: "user-1",
      kind: "MESSAGE_KIND_TEXT",
      text: {
        text: "hello",
        markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
      },
      tombstone: null,
      pinned: false,
      attachments: [],
      createdAt: "2026-03-25T10:11:00Z",
      updatedAt: "2026-03-25T10:11:00Z",
    },
  ],
  readState: null,
  typingState: null,
  presenceState: null,
};

describe("chatsReducer", () => {
  it("preserves thread data when list refresh fails", () => {
    const readyState = chatsReducer(createInitialChatsState(), {
      type: "load_succeeded",
      chats: [directChat],
    });
    const threadState = chatsReducer(readyState, {
      type: "thread_load_succeeded",
      snapshot: threadSnapshot,
    });

    const nextState = chatsReducer(threadState, {
      type: "list_refresh_failed",
      message: "gateway unavailable",
    });

    expect(nextState.status).toBe("ready");
    expect(nextState.thread).toEqual(threadSnapshot);
    expect(nextState.actionErrorMessage).toBe("gateway unavailable");
  });

  it("tracks message-level pending actions independently", () => {
    const readyState = chatsReducer(createInitialChatsState(), {
      type: "load_succeeded",
      chats: [directChat],
    });

    const pendingState = chatsReducer(readyState, {
      type: "message_action_started",
      messageId: "message-1",
      label: "Закрепляем...",
    });
    const finishedState = chatsReducer(pendingState, {
      type: "message_action_finished",
      messageId: "message-1",
    });

    expect(pendingState.pendingMessageActions).toEqual({
      "message-1": "Закрепляем...",
    });
    expect(finishedState.pendingMessageActions).toEqual({});
    expect(finishedState.chats).toEqual([directChat]);
  });

  it("keeps selected chat id when thread load fails", () => {
    const readyState = chatsReducer(createInitialChatsState(), {
      type: "load_succeeded",
      chats: [directChat],
    });

    const nextState = chatsReducer(readyState, {
      type: "thread_load_failed",
      chatId: "chat-1",
      message: "thread unavailable",
    });

    expect(nextState.selectedChatId).toBe("chat-1");
    expect(nextState.threadStatus).toBe("error");
    expect(nextState.threadErrorMessage).toBe("thread unavailable");
  });

  it("updates presence state only for the active loaded thread", () => {
    const readyState = chatsReducer(createInitialChatsState(), {
      type: "load_succeeded",
      chats: [directChat],
    });
    const threadState = chatsReducer(readyState, {
      type: "thread_load_succeeded",
      snapshot: threadSnapshot,
    });

    const nextState = chatsReducer(threadState, {
      type: "presence_state_replaced",
      chatId: "chat-1",
      presenceState: {
        selfPresence: {
          heartbeatAt: "2026-04-06T12:00:00Z",
          expiresAt: "2026-04-06T12:00:30Z",
        },
        peerPresence: {
          heartbeatAt: "2026-04-06T11:59:58Z",
          expiresAt: "2026-04-06T12:00:28Z",
        },
      },
    });

    expect(nextState.thread?.presenceState?.peerPresence?.heartbeatAt).toBe(
      "2026-04-06T11:59:58Z",
    );
  });

  it("upserts message and refreshes chat order from realtime payload", () => {
    const readyState = chatsReducer(createInitialChatsState(), {
      type: "load_succeeded",
      chats: [directChat],
    });
    const threadState = chatsReducer(readyState, {
      type: "thread_load_succeeded",
      snapshot: threadSnapshot,
    });

    const nextState = chatsReducer(threadState, {
      type: "message_updated",
      currentUserId: "user-1",
      reason: "message_created",
      chat: {
        ...directChat,
        updatedAt: "2026-04-06T12:01:00Z",
      },
      message: {
        id: "message-2",
        chatId: "chat-1",
        senderUserId: "user-2",
        kind: "MESSAGE_KIND_TEXT",
        text: {
          text: "world",
          markdownPolicy: "MARKDOWN_POLICY_SAFE_SUBSET_V1",
        },
        tombstone: null,
        pinned: false,
        attachments: [],
        createdAt: "2026-04-06T12:01:00Z",
        updatedAt: "2026-04-06T12:01:00Z",
      },
    });

    expect(nextState.chats[0]?.updatedAt).toBe("2026-04-06T12:01:00Z");
    expect(nextState.thread?.messages.map((message) => message.id)).toEqual([
      "message-1",
      "message-2",
    ]);
  });

  it("patches pinned ids from local message mutation without full refresh", () => {
    const readyState = chatsReducer(createInitialChatsState(), {
      type: "load_succeeded",
      chats: [directChat],
    });
    const threadState = chatsReducer(readyState, {
      type: "thread_load_succeeded",
      snapshot: threadSnapshot,
    });

    const nextState = chatsReducer(threadState, {
      type: "message_updated",
      currentUserId: "user-1",
      reason: "message_pinned",
      message: {
        ...threadSnapshot.messages[0]!,
        pinned: true,
        updatedAt: "2026-04-06T12:02:00Z",
      },
    });

    expect(nextState.chats[0]?.pinnedMessageIds).toEqual(["message-1"]);
    expect(nextState.thread?.messages[0]?.pinned).toBe(true);
  });

  it("replaces active thread read state from realtime update", () => {
    const readyState = chatsReducer(createInitialChatsState(), {
      type: "load_succeeded",
      chats: [directChat],
    });
    const threadState = chatsReducer(readyState, {
      type: "thread_load_succeeded",
      snapshot: threadSnapshot,
    });

    const nextState = chatsReducer(threadState, {
      type: "read_state_replaced",
      chatId: "chat-1",
      readState: {
        selfPosition: null,
        peerPosition: {
          messageId: "message-1",
          messageCreatedAt: "2026-03-25T10:11:00Z",
          updatedAt: "2026-04-06T12:03:00Z",
        },
      },
    });

    expect(nextState.thread?.readState?.peerPosition?.messageId).toBe("message-1");
  });

  it("replaces active thread typing state from realtime update", () => {
    const readyState = chatsReducer(createInitialChatsState(), {
      type: "load_succeeded",
      chats: [directChat],
    });
    const threadState = chatsReducer(readyState, {
      type: "thread_load_succeeded",
      snapshot: threadSnapshot,
    });

    const nextState = chatsReducer(threadState, {
      type: "typing_state_replaced",
      chatId: "chat-1",
      typingState: {
        selfTyping: null,
        peerTyping: {
          updatedAt: "2026-04-07T12:03:00Z",
          expiresAt: "2026-04-07T12:03:06Z",
        },
      },
    });

    expect(nextState.thread?.typingState?.peerTyping?.updatedAt).toBe(
      "2026-04-07T12:03:00Z",
    );
  });

  it("replaces active thread presence state idempotently", () => {
    const readyState = chatsReducer(createInitialChatsState(), {
      type: "load_succeeded",
      chats: [directChat],
    });
    const threadState = chatsReducer(readyState, {
      type: "thread_load_succeeded",
      snapshot: threadSnapshot,
    });
    const presenceState = {
      selfPresence: null,
      peerPresence: {
        heartbeatAt: "2026-04-07T12:04:00Z",
        expiresAt: "2026-04-07T12:04:30Z",
      },
    };

    const firstState = chatsReducer(threadState, {
      type: "presence_state_replaced",
      chatId: "chat-1",
      presenceState,
    });
    const secondState = chatsReducer(firstState, {
      type: "presence_state_replaced",
      chatId: "chat-1",
      presenceState,
    });

    expect(secondState.thread?.presenceState).toEqual(presenceState);
  });
});
