import type { DirectChat, RtcCall, RtcCallParticipant } from "../gateway/types";

export type DirectCallAwarenessSyncStatus = "idle" | "loading" | "ready" | "error";

export interface DirectCallAwarenessEntry {
  chat: DirectChat;
  call: RtcCall;
  participants: RtcCallParticipant[];
  syncStatus: Exclude<DirectCallAwarenessSyncStatus, "idle">;
  errorMessage: string | null;
}

export interface DirectCallAwarenessState {
  syncStatus: DirectCallAwarenessSyncStatus;
  errorMessage: string | null;
  chatsById: Record<string, DirectChat>;
  activeCallsByChatId: Record<string, DirectCallAwarenessEntry>;
  dismissedCallIdsByChatId: Record<string, string>;
}

export type DirectCallAwarenessAction =
  | { type: "full_sync_started" }
  | {
      type: "full_sync_succeeded";
      chats: DirectChat[];
      activeEntries: DirectCallAwarenessEntry[];
    }
  | { type: "full_sync_failed"; message: string }
  | {
      type: "chat_sync_succeeded";
      chat: DirectChat | null;
      chatId: string;
      call: RtcCall | null;
      participants: RtcCallParticipant[];
    }
  | { type: "chat_sync_failed"; chatId: string; message: string }
  | { type: "surface_dismissed"; chatId: string; callId: string };

export function createInitialDirectCallAwarenessState(): DirectCallAwarenessState {
  return {
    syncStatus: "idle",
    errorMessage: null,
    chatsById: {},
    activeCallsByChatId: {},
    dismissedCallIdsByChatId: {},
  };
}

export function directCallAwarenessReducer(
  state: DirectCallAwarenessState,
  action: DirectCallAwarenessAction,
): DirectCallAwarenessState {
  switch (action.type) {
    case "full_sync_started":
      return {
        ...state,
        syncStatus: "loading",
        errorMessage: null,
      };
    case "full_sync_succeeded": {
      const chatsById = toChatsById(action.chats);
      const activeCallsByChatId = toActiveCallsByChatId(action.activeEntries);

      return {
        syncStatus: "ready",
        errorMessage: null,
        chatsById,
        activeCallsByChatId,
        dismissedCallIdsByChatId: retainDismissedCallIds(
          state.dismissedCallIdsByChatId,
          activeCallsByChatId,
        ),
      };
    }
    case "full_sync_failed":
      return {
        ...state,
        syncStatus: "error",
        errorMessage: action.message,
      };
    case "chat_sync_succeeded": {
      const chatsById =
        action.chat === null
          ? state.chatsById
          : {
              ...state.chatsById,
              [action.chat.id]: action.chat,
            };
      const nextActiveCallsByChatId = { ...state.activeCallsByChatId };
      const nextDismissedCallIdsByChatId = { ...state.dismissedCallIdsByChatId };

      if (action.call === null || action.call.scope.kind !== "direct") {
        delete nextActiveCallsByChatId[action.chatId];
        delete nextDismissedCallIdsByChatId[action.chatId];
      } else {
        const chat = action.chat ?? state.chatsById[action.chatId] ?? null;
        if (chat !== null) {
          nextActiveCallsByChatId[action.chatId] = {
            chat,
            call: action.call,
            participants: action.participants,
            syncStatus: "ready",
            errorMessage: null,
          };
          if (nextDismissedCallIdsByChatId[action.chatId] !== action.call.id) {
            delete nextDismissedCallIdsByChatId[action.chatId];
          }
        }
      }

      return {
        ...state,
        syncStatus: "ready",
        errorMessage: null,
        chatsById,
        activeCallsByChatId: nextActiveCallsByChatId,
        dismissedCallIdsByChatId: nextDismissedCallIdsByChatId,
      };
    }
    case "chat_sync_failed": {
      const activeEntry = state.activeCallsByChatId[action.chatId];
      if (activeEntry === undefined) {
        return {
          ...state,
          errorMessage: action.message,
        };
      }

      return {
        ...state,
        errorMessage: action.message,
        activeCallsByChatId: {
          ...state.activeCallsByChatId,
          [action.chatId]: {
            ...activeEntry,
            syncStatus: "error",
            errorMessage: action.message,
          },
        },
      };
    }
    case "surface_dismissed":
      return {
        ...state,
        dismissedCallIdsByChatId: {
          ...state.dismissedCallIdsByChatId,
          [action.chatId]: action.callId,
        },
      };
    default:
      return state;
  }
}

export function selectDirectCallAwarenessEntry(
  state: DirectCallAwarenessState,
  chatId: string | null,
): DirectCallAwarenessEntry | null {
  if (chatId === null) {
    return null;
  }

  return state.activeCallsByChatId[chatId] ?? null;
}

export function selectVisibleDirectCallSurfaceEntry(
  state: DirectCallAwarenessState,
  currentChatId: string | null,
): DirectCallAwarenessEntry | null {
  const visibleEntries = Object.values(state.activeCallsByChatId)
    .filter((entry) => entry.call.scope.kind === "direct")
    .filter((entry) => entry.chat.id !== currentChatId)
    .filter(
      (entry) => state.dismissedCallIdsByChatId[entry.chat.id] !== entry.call.id,
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.call.updatedAt || left.call.createdAt || "");
      const rightTime = Date.parse(right.call.updatedAt || right.call.createdAt || "");
      return rightTime - leftTime;
    });

  return visibleEntries[0] ?? null;
}

export function selectDirectCallAwarenessChatIdsByCallId(
  state: DirectCallAwarenessState,
): Record<string, string> {
  return Object.values(state.activeCallsByChatId).reduce<Record<string, string>>(
    (result, entry) => {
      result[entry.call.id] = entry.chat.id;
      return result;
    },
    {},
  );
}

function toChatsById(chats: DirectChat[]): Record<string, DirectChat> {
  return chats.reduce<Record<string, DirectChat>>((result, chat) => {
    result[chat.id] = chat;
    return result;
  }, {});
}

function toActiveCallsByChatId(
  entries: DirectCallAwarenessEntry[],
): Record<string, DirectCallAwarenessEntry> {
  return entries.reduce<Record<string, DirectCallAwarenessEntry>>((result, entry) => {
    result[entry.chat.id] = entry;
    return result;
  }, {});
}

function retainDismissedCallIds(
  dismissedCallIdsByChatId: Record<string, string>,
  activeCallsByChatId: Record<string, DirectCallAwarenessEntry>,
): Record<string, string> {
  return Object.entries(dismissedCallIdsByChatId).reduce<Record<string, string>>(
    (result, [chatId, callId]) => {
      if (activeCallsByChatId[chatId]?.call.id === callId) {
        result[chatId] = callId;
      }

      return result;
    },
    {},
  );
}
