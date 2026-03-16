import { useEffect, useReducer, useRef } from "react";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type DirectChat,
} from "../gateway/types";
import {
  chatsReducer,
  createInitialChatsState,
  type ChatThreadSnapshot,
} from "./state";

interface UseChatsOptions {
  enabled: boolean;
  token: string;
  onUnauthenticated(): void;
}

interface MessageMutationOptions {
  fallbackMessage: string;
  messageId: string;
  pendingLabel: string;
  perform(chatId: string): Promise<void>;
}

export function useChats({ enabled, token, onUnauthenticated }: UseChatsOptions) {
  const [state, dispatch] = useReducer(
    chatsReducer,
    undefined,
    createInitialChatsState,
  );
  const mountedRef = useRef(false);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    mountedRef.current = true;
    void loadInitialChats(token, onUnauthenticated, mountedRef, dispatch);

    return () => {
      mountedRef.current = false;
    };
  }, [enabled, token, onUnauthenticated]);

  async function reloadChats() {
    if (state.status === "loading") {
      return;
    }

    if (state.status === "error") {
      await loadInitialChats(token, onUnauthenticated, mountedRef, dispatch);
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
        onUnauthenticated,
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
        onUnauthenticated,
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
        onUnauthenticated,
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

  async function sendMessage(text: string): Promise<boolean> {
    const chatId = stateRef.current.selectedChatId;
    if (!chatId) {
      return false;
    }

    dispatch({ type: "clear_feedback" });
    dispatch({ type: "send_started" });

    try {
      await gatewayClient.sendTextMessage(token, chatId, text);
      await refreshCurrentSelection(
        token,
        chatId,
        mountedRef,
        dispatch,
        onUnauthenticated,
        null,
      );
      return true;
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось отправить сообщение через gateway.",
        onUnauthenticated,
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

  async function deleteMessageForEveryone(messageId: string) {
    return runMessageMutation(
      token,
      mountedRef,
      dispatch,
      stateRef,
      onUnauthenticated,
      {
        messageId,
        pendingLabel: "Удаляем...",
        fallbackMessage: "Не удалось удалить сообщение для всех.",
        perform: (chatId) =>
          gatewayClient.deleteMessageForEveryone(token, chatId, messageId).then(() => {}),
      },
    );
  }

  async function pinMessage(messageId: string) {
    return runMessageMutation(
      token,
      mountedRef,
      dispatch,
      stateRef,
      onUnauthenticated,
      {
        messageId,
        pendingLabel: "Закрепляем...",
        fallbackMessage: "Не удалось закрепить сообщение.",
        perform: (chatId) =>
          gatewayClient.pinMessage(token, chatId, messageId).then(() => {}),
      },
    );
  }

  async function unpinMessage(messageId: string) {
    return runMessageMutation(
      token,
      mountedRef,
      dispatch,
      stateRef,
      onUnauthenticated,
      {
        messageId,
        pendingLabel: "Открепляем...",
        fallbackMessage: "Не удалось открепить сообщение.",
        perform: (chatId) =>
          gatewayClient.unpinMessage(token, chatId, messageId).then(() => {}),
      },
    );
  }

  return {
    state,
    reloadChats,
    openChat,
    ensureDirectChat,
    sendMessage,
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
  onUnauthenticated: () => void,
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
      onUnauthenticated,
    );
    if (!mountedRef.current || message === null) {
      return;
    }

    dispatch({ type: "load_failed", message });
  }
}

async function refreshCurrentSelection(
  token: string,
  chatId: string,
  mountedRef: { current: boolean },
  dispatch: ChatsDispatch,
  onUnauthenticated: () => void,
  notice: string | null,
) {
  const [snapshot, chats] = await Promise.all([
    fetchThreadSnapshot(token, chatId),
    gatewayClient.listDirectChats(token),
  ]);

  if (!mountedRef.current) {
    return;
  }

  dispatch({
    type: "thread_load_succeeded",
    snapshot,
  });
  dispatch({
    type: "list_refresh_succeeded",
    chats,
    notice,
  });
}

async function runMessageMutation(
  token: string,
  mountedRef: { current: boolean },
  dispatch: ChatsDispatch,
  stateRef: { current: ReturnType<typeof createInitialChatsState> },
  onUnauthenticated: () => void,
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
    await options.perform(chatId);
    await refreshCurrentSelection(
      token,
      chatId,
      mountedRef,
      dispatch,
      onUnauthenticated,
      null,
    );
    return true;
  } catch (error) {
    const message = resolveProtectedError(
      error,
      options.fallbackMessage,
      onUnauthenticated,
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
  const latestMessage = messages.at(-1);
  if (latestMessage) {
    readState =
      (await gatewayClient.markDirectChatRead(token, chatId, latestMessage.id)) ??
      readState;
  }

  return {
    chat: snapshot.chat,
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
  onUnauthenticated: () => void,
): string | null {
  if (isGatewayErrorCode(error, "unauthenticated")) {
    onUnauthenticated();
    return null;
  }

  return describeGatewayError(error, fallbackMessage);
}
