import type {
  DirectChat,
  DirectChatMessage,
  DirectChatPresenceState,
  DirectChatReadState,
  DirectChatTypingState,
} from "../gateway/types";

export interface ChatThreadSnapshot {
  chat: DirectChat;
  messages: DirectChatMessage[];
  readState: DirectChatReadState | null;
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
    case "thread_load_started":
      return {
        ...state,
        selectedChatId: action.chatId,
        threadStatus: "loading",
        threadErrorMessage: null,
        actionErrorMessage: null,
        notice: null,
      };
    case "thread_load_succeeded":
      return {
        ...state,
        selectedChatId: action.snapshot.chat.id,
        threadStatus: "ready",
        thread: action.snapshot,
        threadErrorMessage: null,
      };
    case "thread_load_failed":
      return {
        ...state,
        selectedChatId: action.chatId,
        threadStatus: "error",
        threadErrorMessage: action.message,
      };
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
