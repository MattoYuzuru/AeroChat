import { useEffect, useReducer, useRef, useState } from "react";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type DirectChat,
  type DirectChatMessage,
} from "../gateway/types";
import { subscribeRealtimeEnvelopes } from "../realtime/events";
import {
  DIRECT_CHAT_PRESENCE_HEARTBEAT_INTERVAL_MS,
  resolveDirectChatPresenceHeartbeatChatId,
} from "./presence";
import {
  DIRECT_CHAT_TYPING_IDLE_TIMEOUT_MS,
  DIRECT_CHAT_TYPING_REFRESH_INTERVAL_MS,
  resolveDirectChatTypingSessionChatId,
} from "./typing";
import { parseDirectChatRealtimeEvent } from "./realtime";
import {
  chatsReducer,
  createInitialChatsState,
  type ChatThreadSnapshot,
} from "./state";

interface UseChatsOptions {
  enabled: boolean;
  token: string;
  currentUserId: string;
  composerText: string;
  onUnauthenticated(): void;
}

interface MessageMutationOptions {
  fallbackMessage: string;
  messageId: string;
  pendingLabel: string;
  perform(chatId: string): Promise<DirectChatMessage>;
  reason: string;
}

interface MessageTextMutationOptions {
  fallbackMessage: string;
  messageId: string;
  pendingLabel: string;
  text: string;
  perform(chatId: string, text: string): Promise<DirectChatMessage>;
  reason: string;
}

export function useChats({
  enabled,
  token,
  currentUserId,
  composerText,
  onUnauthenticated,
}: UseChatsOptions) {
  const [state, dispatch] = useReducer(
    chatsReducer,
    undefined,
    createInitialChatsState,
  );
  const mountedRef = useRef(false);
  const stateRef = useRef(state);
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  const activePresenceChatIdRef = useRef<string | null>(null);
  const activeTypingChatIdRef = useRef<string | null>(null);
  const typingLastSentAtRef = useRef(0);
  const typingRefreshTimerRef = useRef<number | null>(null);
  const typingIdleTimerRef = useRef<number | null>(null);
  const isPageVisible = usePageVisibility();

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onUnauthenticatedRef.current = onUnauthenticated;
  }, [onUnauthenticated]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    mountedRef.current = true;
    void loadInitialChats(token, onUnauthenticatedRef, mountedRef, dispatch);

    return () => {
      mountedRef.current = false;
    };
  }, [enabled, token]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      if (!mountedRef.current) {
        return;
      }

      const event = parseDirectChatRealtimeEvent(envelope);
      if (!event) {
        return;
      }

      if (event.type === "direct_chat.message.updated") {
        dispatch({
          type: "message_updated",
          currentUserId,
          message: event.message,
          reason: event.reason,
        });
        return;
      }

      if (event.type === "direct_chat.read.updated") {
        dispatch({
          type: "read_state_replaced",
          chatId: event.chatId,
          readState: event.readState,
          unreadCount: event.unreadCount,
        });
        return;
      }

      if (event.type === "direct_chat.typing.updated") {
        dispatch({
          type: "typing_state_replaced",
          chatId: event.chatId,
          typingState: event.typingState,
        });
        return;
      }

      dispatch({
        type: "presence_state_replaced",
        chatId: event.chatId,
        presenceState: event.presenceState,
      });
    });
  }, [enabled, currentUserId]);

  const activePresenceChatId = resolveDirectChatPresenceHeartbeatChatId({
    enabled,
    pageVisible: isPageVisible,
    selectedChatId: state.selectedChatId,
    threadChatId: state.thread?.chat.id ?? null,
  });
  const activeTypingChatId = resolveDirectChatTypingSessionChatId({
    enabled,
    pageVisible: isPageVisible,
    selectedChatId: state.selectedChatId,
    threadChatId: state.thread?.chat.id ?? null,
    composerText,
  });

  useEffect(() => {
    const threadChatID = state.thread?.chat.id ?? null;
    if (activePresenceChatId !== null || threadChatID === null) {
      return;
    }

    dispatch({
      type: "presence_state_replaced",
      chatId: threadChatID,
      presenceState: null,
    });
  }, [activePresenceChatId, state.thread?.chat.id]);

  useEffect(() => {
    const threadChatID = state.thread?.chat.id ?? null;
    if (activeTypingChatId !== null || threadChatID === null) {
      return;
    }

    dispatch({
      type: "typing_state_replaced",
      chatId: threadChatID,
      typingState: null,
    });
  }, [activeTypingChatId, state.thread?.chat.id]);

  useEffect(() => {
    const previousChatId = activePresenceChatIdRef.current;
    activePresenceChatIdRef.current = activePresenceChatId;

    if (previousChatId === null || previousChatId === activePresenceChatId) {
      return;
    }

    void clearDirectChatPresenceSilently(
      token,
      previousChatId,
      mountedRef,
      dispatch,
      onUnauthenticatedRef,
    );
  }, [activePresenceChatId, token]);

  useEffect(() => {
    if (activePresenceChatId === null) {
      return;
    }

    let cancelled = false;
    let timeoutID: number | null = null;

    const scheduleNextHeartbeat = () => {
      if (cancelled) {
        return;
      }

      timeoutID = window.setTimeout(() => {
        void runHeartbeat();
      }, DIRECT_CHAT_PRESENCE_HEARTBEAT_INTERVAL_MS);
    };

    const runHeartbeat = async () => {
      let shouldScheduleNext = true;

      try {
        const presenceState = await gatewayClient.setDirectChatPresenceHeartbeat(
          token,
          activePresenceChatId,
        );
        if (cancelled || !mountedRef.current) {
          return;
        }

        dispatch({
          type: "presence_state_replaced",
          chatId: activePresenceChatId,
          presenceState,
        });
      } catch (error) {
        if (handlePresenceError(error, onUnauthenticatedRef)) {
          shouldScheduleNext = false;
          return;
        }
      } finally {
        if (shouldScheduleNext) {
          scheduleNextHeartbeat();
        }
      }
    };

    void runHeartbeat();

    return () => {
      cancelled = true;
      if (timeoutID !== null) {
        window.clearTimeout(timeoutID);
      }
    };
  }, [activePresenceChatId, token]);

  useEffect(() => {
    const clearTypingTimers = () => {
      if (typingRefreshTimerRef.current !== null) {
        window.clearTimeout(typingRefreshTimerRef.current);
        typingRefreshTimerRef.current = null;
      }
      if (typingIdleTimerRef.current !== null) {
        window.clearTimeout(typingIdleTimerRef.current);
        typingIdleTimerRef.current = null;
      }
    };

    const previousChatId = activeTypingChatIdRef.current;

    if (activeTypingChatId === null) {
      clearTypingTimers();
      typingLastSentAtRef.current = 0;
      activeTypingChatIdRef.current = null;

      if (previousChatId !== null) {
        void clearDirectChatTypingSilently(
          token,
          previousChatId,
          mountedRef,
          dispatch,
          onUnauthenticatedRef,
        );
      }

      return;
    }

    let cancelled = false;
    activeTypingChatIdRef.current = activeTypingChatId;

    if (previousChatId !== null && previousChatId !== activeTypingChatId) {
      typingLastSentAtRef.current = 0;
      void clearDirectChatTypingSilently(
        token,
        previousChatId,
        mountedRef,
        dispatch,
        onUnauthenticatedRef,
      );
    }

    const scheduleRefresh = () => {
      if (cancelled) {
        return;
      }

      clearTypingRefreshTimer(typingRefreshTimerRef);
      typingRefreshTimerRef.current = window.setTimeout(() => {
        void publishTyping(true);
      }, DIRECT_CHAT_TYPING_REFRESH_INTERVAL_MS);
    };

    const scheduleIdleClear = () => {
      if (cancelled) {
        return;
      }

      clearTypingIdleTimer(typingIdleTimerRef);
      typingIdleTimerRef.current = window.setTimeout(() => {
        typingLastSentAtRef.current = 0;
        activeTypingChatIdRef.current = null;
        clearTypingTimers();
        void clearDirectChatTypingSilently(
          token,
          activeTypingChatId,
          mountedRef,
          dispatch,
          onUnauthenticatedRef,
        );
      }, DIRECT_CHAT_TYPING_IDLE_TIMEOUT_MS);
    };

    const publishTyping = async (force: boolean) => {
      if (cancelled) {
        return;
      }

      const now = Date.now();
      if (
        !force &&
        typingLastSentAtRef.current !== 0 &&
        now-typingLastSentAtRef.current < DIRECT_CHAT_TYPING_REFRESH_INTERVAL_MS
      ) {
        scheduleRefresh();
        return;
      }

      try {
        const typingState = await gatewayClient.setDirectChatTyping(token, activeTypingChatId);
        if (cancelled || !mountedRef.current) {
          return;
        }

        typingLastSentAtRef.current = Date.now();
        dispatch({
          type: "typing_state_replaced",
          chatId: activeTypingChatId,
          typingState,
        });
      } catch (error) {
        if (handlePresenceError(error, onUnauthenticatedRef)) {
          clearTypingTimers();
          return;
        }
      } finally {
        if (!cancelled) {
          scheduleRefresh();
        }
      }
    };

    scheduleIdleClear();
    void publishTyping(previousChatId !== activeTypingChatId || typingLastSentAtRef.current === 0);

    return () => {
      cancelled = true;
      clearTypingTimers();
    };
  }, [activeTypingChatId, composerText, token]);

  useEffect(() => {
    return () => {
      const activePresenceChatId = activePresenceChatIdRef.current;
      activePresenceChatIdRef.current = null;
      if (activePresenceChatId !== null) {
        void clearDirectChatPresenceSilently(
          token,
          activePresenceChatId,
          mountedRef,
          dispatch,
          onUnauthenticatedRef,
        );
      }
    };
  }, [token]);

  useEffect(() => {
    return () => {
      const activeTypingChatId = activeTypingChatIdRef.current;
      activeTypingChatIdRef.current = null;
      typingLastSentAtRef.current = 0;
      clearTypingRefreshTimer(typingRefreshTimerRef);
      clearTypingIdleTimer(typingIdleTimerRef);
      if (activeTypingChatId !== null) {
        void clearDirectChatTypingSilently(
          token,
          activeTypingChatId,
          mountedRef,
          dispatch,
          onUnauthenticatedRef,
        );
      }
    };
  }, [token]);

  const latestThreadMessage = state.thread?.messages.at(-1) ?? null;
  const activeThreadChatId = state.thread?.chat.id ?? null;
  const latestThreadMessageId = latestThreadMessage?.id ?? null;
  const shouldAutoMarkRead =
    enabled &&
    isPageVisible &&
    state.threadStatus === "ready" &&
    activeThreadChatId !== null &&
    latestThreadMessage !== null &&
    latestThreadMessage.senderUserId !== currentUserId &&
    state.thread?.readState?.selfPosition?.messageId !== latestThreadMessage.id;

  useEffect(() => {
    if (!shouldAutoMarkRead || activeThreadChatId === null || latestThreadMessageId === null) {
      return;
    }

    let cancelled = false;

    void gatewayClient
      .markDirectChatRead(token, activeThreadChatId, latestThreadMessageId)
      .then((result) => {
        if (cancelled || !mountedRef.current) {
          return;
        }

        dispatch({
          type: "read_state_replaced",
          chatId: activeThreadChatId,
          readState: result.readState,
          unreadCount: result.unreadCount,
        });
      })
      .catch((error) => {
        resolveProtectedError(
          error,
          "Не удалось обновить read state через gateway.",
          onUnauthenticatedRef,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [activeThreadChatId, latestThreadMessageId, shouldAutoMarkRead, token]);

  async function reloadChats() {
    if (state.status === "loading") {
      return;
    }

    if (state.status === "error") {
      await loadInitialChats(token, onUnauthenticatedRef, mountedRef, dispatch);
      return;
    }

    dispatch({ type: "list_refresh_started" });

    try {
      const chats = await gatewayClient.listDirectChats(token);
      if (!mountedRef.current) {
        return;
      }

      dispatch({
        type: "list_refresh_succeeded",
        chats,
        notice: null,
      });
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось обновить список direct chats через gateway.",
        onUnauthenticatedRef,
      );
      if (!mountedRef.current || message === null) {
        return;
      }

      dispatch({ type: "list_refresh_failed", message });
    }
  }

  async function openChat(chatId: string): Promise<boolean> {
    dispatch({ type: "thread_load_started", chatId });

    try {
      const snapshot = await fetchThreadSnapshot(token, chatId);
      if (!mountedRef.current) {
        return false;
      }

      dispatch({
        type: "thread_load_succeeded",
        snapshot,
      });
      return true;
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось загрузить direct chat thread через gateway.",
        onUnauthenticatedRef,
      );
      if (!mountedRef.current || message === null) {
        return false;
      }

      dispatch({
        type: "thread_load_failed",
        chatId,
        message,
      });
      return false;
    }
  }

  async function ensureDirectChat(peerUserId: string): Promise<string | null> {
    dispatch({ type: "clear_feedback" });
    dispatch({ type: "create_started" });

    try {
      let chats = stateRef.current.chats;
      let targetChat = findDirectChatByPeerUserId(chats, peerUserId);
      let notice: string | null = null;

      if (!targetChat) {
        try {
          targetChat = await gatewayClient.createDirectChat(token, peerUserId);
          notice = "Direct chat создан.";
        } catch (error) {
          if (!isGatewayErrorCode(error, "already_exists")) {
            throw error;
          }
        }

        chats = await gatewayClient.listDirectChats(token);
        if (!mountedRef.current) {
          return null;
        }

        dispatch({
          type: "list_refresh_succeeded",
          chats,
          notice,
        });
        targetChat = findDirectChatByPeerUserId(chats, peerUserId) ?? targetChat;
      }

      if (!targetChat) {
        throw new Error("Gateway не вернул доступный direct chat для выбранного друга.");
      }

      const isOpened = await openChat(targetChat.id);
      if (!isOpened) {
        return null;
      }

      return targetChat.id;
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось открыть direct chat через gateway.",
        onUnauthenticatedRef,
      );
      if (!mountedRef.current || message === null) {
        return null;
      }

      dispatch({ type: "list_refresh_failed", message });
      return null;
    } finally {
      if (mountedRef.current) {
        dispatch({ type: "create_finished" });
      }
    }
  }

  async function sendMessage(text: string, attachmentIds: string[] = []): Promise<boolean> {
    const chatId = stateRef.current.selectedChatId;
    if (!chatId) {
      return false;
    }

    dispatch({ type: "clear_feedback" });
    dispatch({ type: "send_started" });

    try {
      const message = await gatewayClient.sendTextMessage(token, chatId, text, attachmentIds);
      if (!mountedRef.current) {
        return false;
      }

      dispatch({
        type: "message_updated",
        currentUserId,
        message,
        reason: "message_created",
      });
      return true;
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось отправить сообщение через gateway.",
        onUnauthenticatedRef,
      );
      if (!mountedRef.current || message === null) {
        return false;
      }

      dispatch({ type: "list_refresh_failed", message });
      return false;
    } finally {
      if (mountedRef.current) {
        dispatch({ type: "send_finished" });
      }
    }
  }

  async function editMessage(messageId: string, text: string) {
    return runMessageTextMutation(
      token,
      mountedRef,
      dispatch,
      stateRef,
      onUnauthenticatedRef,
      {
        messageId,
        text,
        pendingLabel: "Сохраняем...",
        fallbackMessage: "Не удалось сохранить изменения сообщения.",
        reason: "message_edited",
        perform: (chatId, nextText) =>
          gatewayClient.editDirectChatMessage(token, chatId, messageId, nextText),
      },
      currentUserId,
    );
  }

  async function deleteMessageForEveryone(messageId: string) {
    return runMessageMutation(
      token,
      mountedRef,
      dispatch,
      stateRef,
      onUnauthenticatedRef,
      {
        messageId,
        pendingLabel: "Удаляем...",
        fallbackMessage: "Не удалось удалить сообщение для всех.",
        reason: "message_deleted_for_everyone",
        perform: (chatId) =>
          gatewayClient.deleteMessageForEveryone(token, chatId, messageId),
      },
    );
  }

  async function pinMessage(messageId: string) {
    return runMessageMutation(
      token,
      mountedRef,
      dispatch,
      stateRef,
      onUnauthenticatedRef,
      {
        messageId,
        pendingLabel: "Закрепляем...",
        fallbackMessage: "Не удалось закрепить сообщение.",
        reason: "message_pinned",
        perform: (chatId) => gatewayClient.pinMessage(token, chatId, messageId),
      },
    );
  }

  async function unpinMessage(messageId: string) {
    return runMessageMutation(
      token,
      mountedRef,
      dispatch,
      stateRef,
      onUnauthenticatedRef,
      {
        messageId,
        pendingLabel: "Открепляем...",
        fallbackMessage: "Не удалось открепить сообщение.",
        reason: "message_unpinned",
        perform: (chatId) => gatewayClient.unpinMessage(token, chatId, messageId),
      },
    );
  }

  return {
    state,
    reloadChats,
    openChat,
    ensureDirectChat,
    sendMessage,
    editMessage,
    deleteMessageForEveryone,
    pinMessage,
    unpinMessage,
    clearFeedback() {
      dispatch({ type: "clear_feedback" });
    },
  };
}

type ChatsDispatch = (action: Parameters<typeof chatsReducer>[1]) => void;

async function loadInitialChats(
  token: string,
  onUnauthenticatedRef: { current: () => void },
  mountedRef: { current: boolean },
  dispatch: ChatsDispatch,
) {
  dispatch({ type: "load_started" });

  try {
    const chats = await gatewayClient.listDirectChats(token);
    if (!mountedRef.current) {
      return;
    }

    dispatch({ type: "load_succeeded", chats });
  } catch (error) {
    const message = resolveProtectedError(
      error,
      "Не удалось загрузить direct chats через gateway.",
      onUnauthenticatedRef,
    );
    if (!mountedRef.current || message === null) {
      return;
    }

    dispatch({ type: "load_failed", message });
  }
}

async function runMessageMutation(
  token: string,
  mountedRef: { current: boolean },
  dispatch: ChatsDispatch,
  stateRef: { current: ReturnType<typeof createInitialChatsState> },
  onUnauthenticatedRef: { current: () => void },
  options: MessageMutationOptions,
): Promise<boolean> {
  const chatId = stateRef.current.selectedChatId;
  if (!chatId) {
    return false;
  }

  dispatch({ type: "clear_feedback" });
  dispatch({
    type: "message_action_started",
    messageId: options.messageId,
    label: options.pendingLabel,
  });

  try {
    const message = await options.perform(chatId);
    if (!mountedRef.current) {
      return false;
    }

    dispatch({
      type: "message_updated",
      currentUserId: "",
      message,
      reason: options.reason,
    });
    return true;
  } catch (error) {
    const message = resolveProtectedError(
      error,
      options.fallbackMessage,
      onUnauthenticatedRef,
    );
    if (!mountedRef.current || message === null) {
      return false;
    }

    dispatch({ type: "list_refresh_failed", message });
    return false;
  } finally {
    if (mountedRef.current) {
      dispatch({
        type: "message_action_finished",
        messageId: options.messageId,
      });
    }
  }
}

async function runMessageTextMutation(
  token: string,
  mountedRef: { current: boolean },
  dispatch: ChatsDispatch,
  stateRef: { current: ReturnType<typeof createInitialChatsState> },
  onUnauthenticatedRef: { current: () => void },
  options: MessageTextMutationOptions,
  currentUserId: string,
): Promise<boolean> {
  const chatId = stateRef.current.selectedChatId;
  if (!chatId) {
    return false;
  }

  dispatch({ type: "clear_feedback" });
  dispatch({
    type: "message_action_started",
    messageId: options.messageId,
    label: options.pendingLabel,
  });

  try {
    const message = await options.perform(chatId, options.text);
    if (!mountedRef.current) {
      return false;
    }

    dispatch({
      type: "message_updated",
      currentUserId,
      message,
      reason: options.reason,
    });
    return true;
  } catch (error) {
    const message = resolveProtectedError(
      error,
      options.fallbackMessage,
      onUnauthenticatedRef,
    );
    if (!mountedRef.current || message === null) {
      return false;
    }

    dispatch({ type: "list_refresh_failed", message });
    return false;
  } finally {
    if (mountedRef.current) {
      dispatch({
        type: "message_action_finished",
        messageId: options.messageId,
      });
    }
  }
}

async function fetchThreadSnapshot(
  token: string,
  chatId: string,
): Promise<ChatThreadSnapshot> {
  const [snapshot, rawMessages] = await Promise.all([
    gatewayClient.getDirectChat(token, chatId),
    gatewayClient.listDirectChatMessages(token, chatId, 50),
  ]);
  const messages = [...rawMessages].reverse();

  let readState = snapshot.readState;
  let unreadCount = snapshot.chat.unreadCount;
  const latestMessage = messages.at(-1);
  if (latestMessage) {
    const readUpdate = await gatewayClient.markDirectChatRead(token, chatId, latestMessage.id);
    readState = readUpdate.readState ?? readState;
    unreadCount = readUpdate.unreadCount;
  }

  return {
    chat: {
      ...snapshot.chat,
      unreadCount,
    },
    messages,
    readState,
    typingState: snapshot.typingState,
    presenceState: snapshot.presenceState,
  };
}

function findDirectChatByPeerUserId(
  chats: DirectChat[],
  peerUserId: string,
): DirectChat | null {
  return (
    chats.find((chat) =>
      chat.participants.some((participant) => participant.id === peerUserId),
    ) ?? null
  );
}

function resolveProtectedError(
  error: unknown,
  fallbackMessage: string,
  onUnauthenticatedRef: { current: () => void },
): string | null {
  if (isGatewayErrorCode(error, "unauthenticated")) {
    onUnauthenticatedRef.current();
    return null;
  }

  return describeGatewayError(error, fallbackMessage);
}

function handlePresenceError(
  error: unknown,
  onUnauthenticatedRef: { current: () => void },
): boolean {
  if (!isGatewayErrorCode(error, "unauthenticated")) {
    return false;
  }

  onUnauthenticatedRef.current();
  return true;
}

function clearTypingRefreshTimer(ref: { current: number | null }) {
  if (ref.current === null) {
    return;
  }

  window.clearTimeout(ref.current);
  ref.current = null;
}

function clearTypingIdleTimer(ref: { current: number | null }) {
  if (ref.current === null) {
    return;
  }

  window.clearTimeout(ref.current);
  ref.current = null;
}

async function clearDirectChatTypingSilently(
  token: string,
  chatId: string,
  mountedRef: { current: boolean },
  dispatch: ChatsDispatch,
  onUnauthenticatedRef: { current: () => void },
) {
  try {
    const typingState = await gatewayClient.clearDirectChatTyping(token, chatId);
    if (!mountedRef.current) {
      return;
    }

    dispatch({
      type: "typing_state_replaced",
      chatId,
      typingState,
    });
  } catch (error) {
    handlePresenceError(error, onUnauthenticatedRef);
  }
}

async function clearDirectChatPresenceSilently(
  token: string,
  chatId: string,
  mountedRef: { current: boolean },
  dispatch: ChatsDispatch,
  onUnauthenticatedRef: { current: () => void },
) {
  try {
    const presenceState = await gatewayClient.clearDirectChatPresence(token, chatId);
    if (!mountedRef.current) {
      return;
    }

    dispatch({
      type: "presence_state_replaced",
      chatId,
      presenceState,
    });
  } catch (error) {
    handlePresenceError(error, onUnauthenticatedRef);
  }
}

function usePageVisibility(): boolean {
  const [isPageVisible, setIsPageVisible] = useState(() => {
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
      setIsPageVisible(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return isPageVisible;
}
