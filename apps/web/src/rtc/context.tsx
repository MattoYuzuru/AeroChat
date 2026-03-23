import {
  createContext,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useAuth } from "../auth/useAuth";
import { gatewayClient } from "../gateway/runtime";
import { describeGatewayError, isGatewayErrorCode } from "../gateway/types";
import {
  createInitialDirectCallAwarenessState,
  directCallAwarenessReducer,
  selectDirectCallAwarenessChatIdsByCallId,
  type DirectCallAwarenessEntry,
  type DirectCallAwarenessState,
} from "./awareness";
import { subscribeRealtimeEnvelopes, subscribeRealtimeLifecycleEvents } from "../realtime/events";
import { parseRTCRealtimeEvent } from "./realtime";

const refreshActiveCallsIntervalMs = 5000;

interface DirectCallAwarenessContextValue {
  state: DirectCallAwarenessState;
  refreshAllActiveDirectCalls(showLoading?: boolean): Promise<void>;
  refreshDirectChatCall(chatId: string, showLoading?: boolean): Promise<void>;
  dismissSurface(chatId: string, callId: string): void;
  getEntry(chatId: string | null): DirectCallAwarenessEntry | null;
}

const DirectCallAwarenessContext = createContext<DirectCallAwarenessContextValue | null>(null);

export function DirectCallAwarenessProvider({ children }: PropsWithChildren) {
  const { state: authState, expireSession } = useAuth();
  const [state, dispatch] = useReducer(
    directCallAwarenessReducer,
    undefined,
    createInitialDirectCallAwarenessState,
  );
  const stateRef = useRef(state);
  const isPageVisible = usePageVisibility();
  const token = authState.status === "authenticated" ? authState.token : "";

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const resolveProtectedError = useCallback(
    (error: unknown, fallbackMessage: string): string => {
      if (isGatewayErrorCode(error, "unauthenticated")) {
        expireSession();
      }

      return describeGatewayError(error, fallbackMessage);
    },
    [expireSession],
  );

  const refreshAllActiveDirectCalls = useCallback(
    async (showLoading = false) => {
      if (authState.status !== "authenticated") {
        return;
      }

      if (showLoading) {
        dispatch({ type: "full_sync_started" });
      }

      try {
        const chats = await gatewayClient.listDirectChats(token);
        const activeEntries = (
          await Promise.all<DirectCallAwarenessEntry | null>(
            chats.map(async (chat) => {
              const call = await gatewayClient.getActiveCall(token, {
                kind: "direct",
                directChatId: chat.id,
              });
              if (call === null || call.scope.kind !== "direct") {
                return null;
              }

              const participants = await gatewayClient.listCallParticipants(token, call.id);
              return {
                chat,
                call,
                participants,
                syncStatus: "ready",
                errorMessage: null,
              };
            }),
          )
        ).filter((entry): entry is DirectCallAwarenessEntry => entry !== null);

        dispatch({
          type: "full_sync_succeeded",
          chats,
          activeEntries,
        });
      } catch (error) {
        dispatch({
          type: "full_sync_failed",
          message: resolveProtectedError(
            error,
            "Не удалось обновить active direct calls из RTC control plane.",
          ),
        });
      }
    },
    [authState.status, resolveProtectedError, token],
  );

  const refreshDirectChatCall = useCallback(
    async (chatId: string, showLoading = false) => {
      const normalizedChatId = chatId.trim();
      if (authState.status !== "authenticated" || normalizedChatId === "") {
        return;
      }

      if (showLoading) {
        dispatch({ type: "full_sync_started" });
      }

      try {
        let chat = stateRef.current.chatsById[normalizedChatId] ?? null;
        if (chat === null) {
          const chats = await gatewayClient.listDirectChats(token);
          chat = chats.find((item) => item.id === normalizedChatId) ?? null;
        }

        const call = await gatewayClient.getActiveCall(token, {
          kind: "direct",
          directChatId: normalizedChatId,
        });
        const participants =
          call === null ? [] : await gatewayClient.listCallParticipants(token, call.id);

        dispatch({
          type: "chat_sync_succeeded",
          chat,
          chatId: normalizedChatId,
          call,
          participants,
        });
      } catch (error) {
        dispatch({
          type: "chat_sync_failed",
          chatId: normalizedChatId,
          message: resolveProtectedError(
            error,
            "Не удалось обновить direct-call состояние для выбранного чата.",
          ),
        });
      }
    },
    [authState.status, resolveProtectedError, token],
  );

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    void refreshAllActiveDirectCalls(true);
  }, [authState.status, refreshAllActiveDirectCalls]);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    return subscribeRealtimeLifecycleEvents((event) => {
      if (event.type === "realtime.connected") {
        void refreshAllActiveDirectCalls(false);
      }
    });
  }, [authState.status, refreshAllActiveDirectCalls]);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      const event = parseRTCRealtimeEvent(envelope);
      if (event === null) {
        return;
      }

      if (event.type === "rtc.call.updated") {
        if (event.call.scope.kind === "direct" && event.call.scope.directChatId) {
          void refreshDirectChatCall(event.call.scope.directChatId, false);
        }
        return;
      }

      if (event.type === "rtc.participant.updated") {
        const chatIdByCallId = selectDirectCallAwarenessChatIdsByCallId(stateRef.current);
        const targetChatId = chatIdByCallId[event.callId] ?? null;
        if (targetChatId === null) {
          void refreshAllActiveDirectCalls(false);
          return;
        }

        void refreshDirectChatCall(targetChatId, false);
      }
    });
  }, [authState.status, refreshAllActiveDirectCalls, refreshDirectChatCall]);

  useEffect(() => {
    if (
      authState.status !== "authenticated" ||
      !isPageVisible ||
      Object.keys(state.activeCallsByChatId).length === 0
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshAllActiveDirectCalls(false);
    }, refreshActiveCallsIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authState.status, isPageVisible, refreshAllActiveDirectCalls, state.activeCallsByChatId]);

  const value: DirectCallAwarenessContextValue = {
    state,
    refreshAllActiveDirectCalls,
    refreshDirectChatCall,
    dismissSurface(chatId, callId) {
      dispatch({
        type: "surface_dismissed",
        chatId,
        callId,
      });
    },
    getEntry(chatId) {
      if (chatId === null) {
        return null;
      }

      return stateRef.current.activeCallsByChatId[chatId] ?? null;
    },
  };

  return (
    <DirectCallAwarenessContext.Provider value={value}>
      {children}
    </DirectCallAwarenessContext.Provider>
  );
}

function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof document === "undefined") {
      return true;
    }

    return document.visibilityState !== "hidden";
  });

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return isVisible;
}

export { DirectCallAwarenessContext };
