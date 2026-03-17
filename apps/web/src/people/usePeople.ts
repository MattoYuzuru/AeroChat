import { useEffect, useReducer, useRef } from "react";
import { gatewayClient } from "../gateway/runtime";
import { describeGatewayError, isGatewayErrorCode } from "../gateway/types";
import { subscribeRealtimeEnvelopes } from "../realtime/events";
import { parsePeopleRealtimeEvent } from "./realtime";
import {
  createInitialPeopleState,
  peopleReducer,
  type PeopleSnapshot,
} from "./state";

interface UsePeopleOptions {
  enabled: boolean;
  token: string;
  onUnauthenticated(): void;
}

interface MutationOptions {
  fallbackMessage: string;
  login?: string;
  pendingLabel?: string;
  successMessage: string;
  perform(): Promise<void>;
}

export function usePeople({ enabled, token, onUnauthenticated }: UsePeopleOptions) {
  const [state, dispatch] = useReducer(
    peopleReducer,
    undefined,
    createInitialPeopleState,
  );
  const mountedRef = useRef(false);
  const stateRef = useRef(state);
  const onUnauthenticatedRef = useRef(onUnauthenticated);

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
    void loadInitialSnapshot(token, onUnauthenticatedRef, mountedRef, dispatch);

    return () => {
      mountedRef.current = false;
    };
  }, [enabled, token]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      if (!mountedRef.current || stateRef.current.status !== "ready") {
        return;
      }

      const event = parsePeopleRealtimeEvent(envelope);
      if (!event) {
        return;
      }

      dispatch(event);
    });
  }, [enabled]);

  async function reload() {
    if (state.status === "loading") {
      return;
    }

    if (state.status === "error") {
      await loadInitialSnapshot(token, onUnauthenticatedRef, mountedRef, dispatch);
      return;
    }

    dispatch({ type: "refresh_started" });

    try {
      const snapshot = await fetchPeopleSnapshot(token);
      if (!mountedRef.current) {
        return;
      }

      dispatch({
        type: "refresh_succeeded",
        snapshot,
        notice: null,
      });
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось обновить people-данные через gateway.",
        onUnauthenticatedRef,
      );
      if (!mountedRef.current || message === null) {
        return;
      }

      dispatch({ type: "refresh_failed", message });
    }
  }

  async function sendFriendRequest(login: string) {
    return runMutation(token, onUnauthenticatedRef, mountedRef, dispatch, {
      fallbackMessage: "Не удалось отправить заявку в друзья через gateway.",
      successMessage: "Заявка отправлена.",
      perform: () => gatewayClient.sendFriendRequest(token, login),
    });
  }

  async function acceptFriendRequest(login: string) {
    return runMutation(token, onUnauthenticatedRef, mountedRef, dispatch, {
      login,
      pendingLabel: "Принимаем...",
      fallbackMessage: "Не удалось принять входящую заявку.",
      successMessage: "Заявка принята.",
      perform: () => gatewayClient.acceptFriendRequest(token, login),
    });
  }

  async function declineFriendRequest(login: string) {
    return runMutation(token, onUnauthenticatedRef, mountedRef, dispatch, {
      login,
      pendingLabel: "Отклоняем...",
      fallbackMessage: "Не удалось отклонить входящую заявку.",
      successMessage: "Заявка отклонена.",
      perform: () => gatewayClient.declineFriendRequest(token, login),
    });
  }

  async function cancelOutgoingFriendRequest(login: string) {
    return runMutation(token, onUnauthenticatedRef, mountedRef, dispatch, {
      login,
      pendingLabel: "Отменяем...",
      fallbackMessage: "Не удалось отменить исходящую заявку.",
      successMessage: "Исходящая заявка отменена.",
      perform: () => gatewayClient.cancelOutgoingFriendRequest(token, login),
    });
  }

  async function removeFriend(login: string) {
    return runMutation(token, onUnauthenticatedRef, mountedRef, dispatch, {
      login,
      pendingLabel: "Удаляем...",
      fallbackMessage: "Не удалось удалить пользователя из друзей.",
      successMessage: "Пользователь удалён из друзей.",
      perform: () => gatewayClient.removeFriend(token, login),
    });
  }

  return {
    state,
    reload,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelOutgoingFriendRequest,
    removeFriend,
    clearFeedback() {
      dispatch({ type: "clear_feedback" });
    },
  };
}

type PeopleDispatch = (action: Parameters<typeof peopleReducer>[1]) => void;

async function loadInitialSnapshot(
  token: string,
  onUnauthenticatedRef: { current: () => void },
  mountedRef: { current: boolean },
  dispatch: PeopleDispatch,
) {
  dispatch({ type: "load_started" });

  try {
    const snapshot = await fetchPeopleSnapshot(token);
    if (!mountedRef.current) {
      return;
    }

    dispatch({ type: "load_succeeded", snapshot });
  } catch (error) {
    const message = resolveProtectedError(
      error,
      "Не удалось загрузить people-данные через gateway.",
      onUnauthenticatedRef,
    );
    if (!mountedRef.current || message === null) {
      return;
    }

    dispatch({ type: "load_failed", message });
  }
}

async function runMutation(
  token: string,
  onUnauthenticatedRef: { current: () => void },
  mountedRef: { current: boolean },
  dispatch: PeopleDispatch,
  options: MutationOptions,
): Promise<boolean> {
  dispatch({ type: "clear_feedback" });

  if (typeof options.login === "string" && typeof options.pendingLabel === "string") {
    dispatch({
      type: "mutation_started",
      login: options.login,
      label: options.pendingLabel,
    });
  } else {
    dispatch({ type: "send_started" });
  }

  try {
    await options.perform();

    if (!mountedRef.current) {
      return false;
    }

    if (typeof options.login === "string" && typeof options.pendingLabel === "string") {
      dispatch({ type: "mutation_succeeded", notice: options.successMessage });
    } else {
      dispatch({ type: "send_succeeded", notice: options.successMessage });
    }
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

    dispatch({ type: "refresh_failed", message });
    return false;
  } finally {
    if (mountedRef.current) {
      if (typeof options.login === "string" && typeof options.pendingLabel === "string") {
        dispatch({ type: "mutation_finished", login: options.login });
      } else {
        dispatch({ type: "send_finished" });
      }
    }
  }
}

async function fetchPeopleSnapshot(token: string): Promise<PeopleSnapshot> {
  const [incoming, outgoing, friends] = await Promise.all([
    gatewayClient.listIncomingFriendRequests(token),
    gatewayClient.listOutgoingFriendRequests(token),
    gatewayClient.listFriends(token),
  ]);

  return {
    incoming,
    outgoing,
    friends,
  };
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
