import type {
  DirectChat,
  DirectChatMessage,
  DirectChatPresenceState,
  DirectChatReadPosition,
  DirectChatReadState,
  DirectChatTypingState,
  EncryptedDirectChatReadState,
} from "../gateway/types";
import type { EncryptedDirectMessageV2RealtimeEvent } from "./encrypted-v2-realtime";
import { patchLiveEncryptedDirectChatActivity } from "./live-direct-activity";

export interface ChatThreadSnapshot {
  chat: DirectChat;
  messages: DirectChatMessage[];
  readState: DirectChatReadState | null;
  encryptedReadState: EncryptedDirectChatReadState | null;
  typingState: DirectChatTypingState | null;
  presenceState: DirectChatPresenceState | null;
}

export interface ChatsState {
  status: "loading" | "ready" | "error";
  chats: DirectChat[];
  screenErrorMessage: string | null;
  actionErrorMessage: string | null;
  notice: string | null;
  isRefreshingList: boolean;
  isCreatingChat: boolean;
  selectedChatId: string | null;
  threadStatus: "idle" | "loading" | "ready" | "error";
  thread: ChatThreadSnapshot | null;
  threadErrorMessage: string | null;
  isSendingMessage: boolean;
  pendingMessageActions: Record<string, string>;
}

type ChatsAction =
  | { type: "load_started" }
  | { type: "load_succeeded"; chats: DirectChat[] }
  | { type: "load_failed"; message: string }
  | { type: "list_refresh_started" }
  | { type: "list_refresh_succeeded"; chats: DirectChat[]; notice: string | null }
  | { type: "list_refresh_failed"; message: string }
  | { type: "create_started" }
  | { type: "create_finished" }
  | { type: "thread_load_started"; chatId: string }
  | { type: "thread_load_succeeded"; snapshot: ChatThreadSnapshot }
  | { type: "thread_load_failed"; chatId: string; message: string }
  | {
      type: "message_updated";
      currentUserId: string;
      chat?: DirectChat;
      message: DirectChatMessage;
      reason: string;
    }
  | {
      type: "read_state_replaced";
      chatId: string;
      readState: DirectChatReadState | null;
      unreadCount?: number | null;
    }
  | {
      type: "encrypted_read_state_replaced";
      chatId: string;
      readState: EncryptedDirectChatReadState | null;
      unreadCount?: number | null;
    }
  | {
      type: "encrypted_delivery_observed";
      event: EncryptedDirectMessageV2RealtimeEvent;
    }
  | {
      type: "typing_state_replaced";
      chatId: string;
      typingState: DirectChatTypingState | null;
    }
  | {
      type: "presence_state_replaced";
      chatId: string;
      presenceState: DirectChatPresenceState | null;
    }
  | { type: "send_started" }
  | { type: "send_finished" }
  | { type: "message_action_started"; messageId: string; label: string }
  | { type: "message_action_finished"; messageId: string }
  | { type: "clear_feedback" };

export function createInitialChatsState(): ChatsState {
  return {
    status: "loading",
    chats: [],
    screenErrorMessage: null,
    actionErrorMessage: null,
    notice: null,
    isRefreshingList: false,
    isCreatingChat: false,
    selectedChatId: null,
    threadStatus: "idle",
    thread: null,
    threadErrorMessage: null,
    isSendingMessage: false,
    pendingMessageActions: {},
  };
}

export function chatsReducer(
  state: ChatsState,
  action: ChatsAction,
): ChatsState {
  switch (action.type) {
    case "load_started":
      return createInitialChatsState();
    case "load_succeeded":
      return {
        ...state,
        status: "ready",
        chats: action.chats,
        screenErrorMessage: null,
        actionErrorMessage: null,
        notice: null,
        isRefreshingList: false,
      };
    case "load_failed":
      return {
        ...state,
        status: "error",
        screenErrorMessage: action.message,
        actionErrorMessage: null,
        notice: null,
        isRefreshingList: false,
      };
    case "list_refresh_started":
      return {
        ...state,
        isRefreshingList: true,
        actionErrorMessage: null,
        notice: null,
      };
    case "list_refresh_succeeded":
      return {
        ...state,
        status: "ready",
        chats: action.chats,
        screenErrorMessage: null,
        actionErrorMessage: null,
        notice: action.notice,
        isRefreshingList: false,
      };
    case "list_refresh_failed":
      return {
        ...state,
        status: "ready",
        actionErrorMessage: action.message,
        notice: null,
        isRefreshingList: false,
      };
    case "create_started":
      return {
        ...state,
        isCreatingChat: true,
        actionErrorMessage: null,
        notice: null,
      };
    case "create_finished":
      return {
        ...state,
        isCreatingChat: false,
      };
    case "thread_load_started": {
      const keepLoadedThread =
        state.thread?.chat.id === action.chatId ? state.thread : null;

      return {
        ...state,
        selectedChatId: action.chatId,
        threadStatus: "loading",
        thread: keepLoadedThread,
        threadErrorMessage: null,
        actionErrorMessage: null,
        notice: null,
      };
    }
    case "thread_load_succeeded":
      if (
        state.selectedChatId !== null &&
        state.selectedChatId !== action.snapshot.chat.id
      ) {
        return state;
      }

      return {
        ...state,
        selectedChatId: action.snapshot.chat.id,
        threadStatus: "ready",
        thread: action.snapshot,
        threadErrorMessage: null,
      };
    case "thread_load_failed":
      if (state.selectedChatId !== action.chatId) {
        return state;
      }

      return {
        ...state,
        selectedChatId: action.chatId,
        threadStatus: "error",
        threadErrorMessage: action.message,
      };
    case "typing_state_replaced":
      if (state.thread?.chat.id !== action.chatId) {
        return state;
      }

      return {
        ...state,
        thread: {
          ...state.thread,
          typingState: action.typingState,
        },
      };
    case "presence_state_replaced":
      if (state.thread?.chat.id !== action.chatId) {
        return state;
      }

      return {
        ...state,
        thread: {
          ...state.thread,
          presenceState: action.presenceState,
        },
      };
    case "message_updated":
      return applyMessageUpdate(state, action);
    case "read_state_replaced":
      return applyReadStateReplacement(state, action);
    case "encrypted_read_state_replaced":
      return applyEncryptedReadStateReplacement(state, action);
    case "encrypted_delivery_observed":
      return applyEncryptedDeliveryObserved(state, action);
    case "send_started":
      return {
        ...state,
        isSendingMessage: true,
        actionErrorMessage: null,
        notice: null,
      };
    case "send_finished":
      return {
        ...state,
        isSendingMessage: false,
      };
    case "message_action_started":
      return {
        ...state,
        pendingMessageActions: {
          ...state.pendingMessageActions,
          [action.messageId]: action.label,
        },
        actionErrorMessage: null,
        notice: null,
      };
    case "message_action_finished": {
      const nextPendingMessageActions = { ...state.pendingMessageActions };
      delete nextPendingMessageActions[action.messageId];

      return {
        ...state,
        pendingMessageActions: nextPendingMessageActions,
      };
    }
    case "clear_feedback":
      return {
        ...state,
        actionErrorMessage: null,
        notice: null,
      };
    default:
      return state;
  }
}

function applyMessageUpdate(
  state: ChatsState,
  action: Extract<ChatsAction, { type: "message_updated" }>,
): ChatsState {
  const nextChats = upsertChatInList(
    state.chats,
    action.chat ??
      patchChatFromMessage(
        findChatByID(state.chats, action.message.chatId),
        action.message,
        action.reason,
        action.currentUserId,
      ),
  );

  if (state.thread?.chat.id !== action.message.chatId) {
    return {
      ...state,
      chats: nextChats,
    };
  }

  const nextThreadChat =
    action.chat ??
    patchChatFromMessage(
      state.thread.chat,
      action.message,
      action.reason,
      action.currentUserId,
    );
  if (!nextThreadChat) {
    return {
      ...state,
      chats: nextChats,
    };
  }

  return {
    ...state,
    chats: nextChats,
    thread: {
      ...state.thread,
      chat: nextThreadChat,
      messages: upsertMessage(state.thread.messages, action.message),
    },
  };
}

function applyReadStateReplacement(
  state: ChatsState,
  action: Extract<ChatsAction, { type: "read_state_replaced" }>,
): ChatsState {
  const nextChats =
    action.unreadCount === undefined || action.unreadCount === null
      ? state.chats
      : replaceChatUnreadCount(state.chats, action.chatId, action.unreadCount);

  if (state.thread?.chat.id !== action.chatId) {
    return {
      ...state,
      chats: nextChats,
    };
  }

  return {
    ...state,
    chats: nextChats,
    thread: {
      ...state.thread,
      chat:
        action.unreadCount === undefined || action.unreadCount === null
          ? state.thread.chat
          : {
              ...state.thread.chat,
              unreadCount: action.unreadCount,
            },
      readState: action.readState,
    },
  };
}

function applyEncryptedReadStateReplacement(
  state: ChatsState,
  action: Extract<ChatsAction, { type: "encrypted_read_state_replaced" }>,
): ChatsState {
  const nextChats =
    action.unreadCount === undefined || action.unreadCount === null
      ? state.chats
      : replaceChatEncryptedUnreadCount(state.chats, action.chatId, action.unreadCount);

  if (state.thread?.chat.id !== action.chatId) {
    return {
      ...state,
      chats: nextChats,
    };
  }

  return {
    ...state,
    chats: nextChats,
    thread: {
      ...state.thread,
      chat:
        action.unreadCount === undefined || action.unreadCount === null
          ? state.thread.chat
          : {
              ...state.thread.chat,
              encryptedUnreadCount: action.unreadCount,
            },
      encryptedReadState: action.readState,
    },
  };
}

function applyEncryptedDeliveryObserved(
  state: ChatsState,
  action: Extract<ChatsAction, { type: "encrypted_delivery_observed" }>,
): ChatsState {
  const nextChats = patchLiveEncryptedDirectChatActivity(state.chats, action.event);
  const chatId = action.event.envelope.chatId;
  const updatedAt = action.event.envelope.storedAt;
  const unreadCount = action.event.envelope.viewerDelivery.unreadState?.unreadCount ?? null;

  if (state.thread?.chat.id !== chatId) {
    return {
      ...state,
      chats: nextChats,
    };
  }

  return {
    ...state,
    chats: nextChats,
    thread: {
      ...state.thread,
      chat: patchSingleEncryptedChatActivity(
        state.thread.chat,
        updatedAt,
        unreadCount,
      ),
    },
  };
}

function findChatByID(chats: DirectChat[], chatId: string): DirectChat | null {
  return chats.find((chat) => chat.id === chatId) ?? null;
}

function upsertChatInList(chats: DirectChat[], chat: DirectChat | null | undefined): DirectChat[] {
  if (!chat) {
    return chats;
  }

  const nextChats = chats.filter((entry) => entry.id !== chat.id);
  nextChats.push(chat);
  nextChats.sort(compareChatsByUpdatedAtDesc);

  return nextChats;
}

function compareChatsByUpdatedAtDesc(left: DirectChat, right: DirectChat): number {
  if (left.updatedAt === right.updatedAt) {
    return left.id.localeCompare(right.id);
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}

function patchChatFromMessage(
  chat: DirectChat | null,
  message: DirectChatMessage,
  reason: string,
  currentUserId: string,
): DirectChat | null {
  if (!chat) {
    return null;
  }

  const candidateUpdatedAt = resolveChatUpdatedAt(chat.updatedAt, message);
  return {
    ...chat,
    pinnedMessageIds: patchPinnedMessageIDs(chat.pinnedMessageIds, message, reason),
    unreadCount: resolveUnreadCount(chat, message, reason, currentUserId, candidateUpdatedAt),
    updatedAt: candidateUpdatedAt,
  };
}

function patchPinnedMessageIDs(
  current: string[],
  message: DirectChatMessage,
  reason: string,
): string[] {
  if (reason === "message_pinned" || message.pinned) {
    return appendUniqueID(current, message.id);
  }

  if (reason === "message_unpinned" || reason === "message_deleted_for_everyone") {
    return current.filter((value) => value !== message.id);
  }

  return current;
}

function appendUniqueID(values: string[], nextValue: string): string[] {
  if (values.includes(nextValue)) {
    return values;
  }

  return [...values, nextValue];
}

function resolveChatUpdatedAt(currentUpdatedAt: string, message: DirectChatMessage): string {
  const candidate = message.updatedAt || message.createdAt;
  if (candidate === "") {
    return currentUpdatedAt;
  }

  return candidate;
}

function resolveUnreadCount(
  chat: DirectChat,
  message: DirectChatMessage,
  reason: string,
  currentUserId: string,
  candidateUpdatedAt: string,
): number {
  if (
    reason !== "message_created" ||
    message.senderUserId === currentUserId ||
    candidateUpdatedAt === "" ||
    chat.updatedAt >= candidateUpdatedAt
  ) {
    return chat.unreadCount;
  }

  return chat.unreadCount + 1;
}

function upsertMessage(messages: DirectChatMessage[], message: DirectChatMessage): DirectChatMessage[] {
  const nextMessages = messages.filter((entry) => entry.id !== message.id);
  nextMessages.push(message);
  nextMessages.sort(compareMessagesByCreatedAtAsc);

  return nextMessages;
}

function compareMessagesByCreatedAtAsc(
  left: DirectChatMessage,
  right: DirectChatMessage,
): number {
  if (left.createdAt === right.createdAt) {
    return left.id.localeCompare(right.id);
  }

  return left.createdAt.localeCompare(right.createdAt);
}

export function createReadState(
  selfPosition: DirectChatReadPosition | null,
  peerPosition: DirectChatReadPosition | null,
): DirectChatReadState | null {
  if (!selfPosition && !peerPosition) {
    return null;
  }

  return {
    selfPosition,
    peerPosition,
  };
}

function replaceChatUnreadCount(
  chats: DirectChat[],
  chatId: string,
  unreadCount: number,
): DirectChat[] {
  return chats.map((chat) =>
    chat.id !== chatId
      ? chat
      : {
          ...chat,
          unreadCount,
        },
  );
}

function replaceChatEncryptedUnreadCount(
  chats: DirectChat[],
  chatId: string,
  unreadCount: number,
): DirectChat[] {
  return chats.map((chat) =>
    chat.id !== chatId
      ? chat
      : {
          ...chat,
          encryptedUnreadCount: unreadCount,
        },
  );
}

function patchSingleEncryptedChatActivity(
  chat: DirectChat,
  updatedAt: string,
  unreadCount: number | null | undefined,
): DirectChat {
  return {
    ...chat,
    updatedAt:
      updatedAt.trim() !== "" && updatedAt > chat.updatedAt
        ? updatedAt
        : chat.updatedAt,
    encryptedUnreadCount:
      unreadCount === undefined || unreadCount === null
        ? chat.encryptedUnreadCount
        : unreadCount,
  };
}
