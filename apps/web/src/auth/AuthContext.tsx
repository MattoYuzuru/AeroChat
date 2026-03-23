import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { bootstrapAuthSession } from "./bootstrap";
import { AuthContext, type AuthState } from "./context";
import { createBrowserSessionStore } from "./session-store";
import {
  isGatewayErrorCode,
  type LoginInput,
  type RegisterInput,
  type UpdateCurrentProfileInput,
} from "../gateway/types";
import { gatewayClient } from "../gateway/runtime";
import { connectRealtime, type RealtimeConnection } from "../realtime/client";
import {
  publishRealtimeEnvelope,
  publishRealtimeLifecycleEvent,
} from "../realtime/events";
const sessionStore = createBrowserSessionStore();

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({
    status: "bootstrapping",
    notice: null,
  });
  const bootstrappedRef = useRef(false);
  const realtimeRef = useRef<RealtimeConnection | null>(null);
  const authenticatedToken = state.status === "authenticated" ? state.token : null;

  async function retryBootstrap() {
    setState((current) => ({
      status: "bootstrapping",
      notice: current.notice,
    }));

    const result = await bootstrapAuthSession(gatewayClient, sessionStore);
    applyBootstrapResult(result);
  }

  function applyBootstrapResult(result: Awaited<ReturnType<typeof bootstrapAuthSession>>) {
    switch (result.status) {
      case "authenticated":
        setState({
          status: "authenticated",
          token: result.token,
          profile: result.profile,
          notice: result.notice,
        });
        return;
      case "anonymous":
        setState({
          status: "anonymous",
          notice: result.notice,
        });
        return;
      case "error":
        setState((current) => ({
          status: "error",
          token: result.token,
          message: result.message,
          notice: current.notice,
        }));
        return;
    }
  }

  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }

    bootstrappedRef.current = true;
    let active = true;

    void bootstrapAuthSession(gatewayClient, sessionStore).then((result) => {
      if (!active) {
        return;
      }

      applyBootstrapResult(result);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    realtimeRef.current?.close();
    realtimeRef.current = null;

    if (authenticatedToken === null) {
      return;
    }

    const connection = connectRealtime({
      token: authenticatedToken,
      onEvent: publishRealtimeEnvelope,
      onStatusChange: (status) => {
        publishRealtimeLifecycleEvent({
          type:
            status === "connected"
              ? "realtime.connected"
              : "realtime.disconnected",
        });
      },
    });
    realtimeRef.current = connection;

    return () => {
      connection.close();
      if (realtimeRef.current === connection) {
        realtimeRef.current = null;
      }
    };
  }, [authenticatedToken]);

  async function login(input: LoginInput) {
    const auth = await gatewayClient.login(input);
    sessionStore.write(auth.sessionToken);
    setState({
      status: "authenticated",
      token: auth.sessionToken,
      profile: auth.profile,
      notice: null,
    });
  }

  async function register(input: RegisterInput) {
    const auth = await gatewayClient.register(input);
    sessionStore.write(auth.sessionToken);
    setState({
      status: "authenticated",
      token: auth.sessionToken,
      profile: auth.profile,
      notice: null,
    });
  }

  async function logout() {
    if (state.status !== "authenticated" && state.status !== "error") {
      sessionStore.clear();
      setState({
        status: "anonymous",
        notice: "Сессия завершена.",
      });
      return;
    }

    try {
      await gatewayClient.logoutCurrentSession(state.token);
    } catch (error) {
      if (!isGatewayErrorCode(error, "unauthenticated")) {
        throw error;
      }
    }

    sessionStore.clear();
    setState({
      status: "anonymous",
      notice: "Сессия завершена.",
    });
  }

  function discardSession() {
    sessionStore.clear();
    setState({
      status: "anonymous",
      notice: "Локальная сессия очищена.",
    });
  }

  function expireSession(message = "Сессия истекла. Войдите снова.") {
    sessionStore.clear();
    setState({
      status: "anonymous",
      notice: message,
    });
  }

  async function refreshProfile() {
    const token = requireAuthToken(state);

    try {
      const profile = await gatewayClient.getCurrentProfile(token);
      setState({
        status: "authenticated",
        token,
        profile,
        notice: null,
      });

      return profile;
    } catch (error) {
      handleProtectedError(error);
      throw error;
    }
  }

  async function updateProfile(input: UpdateCurrentProfileInput) {
    const token = requireAuthToken(state);

    try {
      const profile = await gatewayClient.updateCurrentProfile(token, input);
      setState({
        status: "authenticated",
        token,
        profile,
        notice: "Изменения сохранены.",
      });

      return profile;
    } catch (error) {
      handleProtectedError(error);
      throw error;
    }
  }

  function clearNotice() {
    setState((current) => ({
      ...current,
      notice: null,
    }));
  }

  function handleProtectedError(error: unknown) {
    if (isGatewayErrorCode(error, "unauthenticated")) {
      expireSession();
    }
  }

  return (
    <AuthContext.Provider
      value={{
        state,
        login,
        register,
        logout,
        discardSession,
        expireSession,
        retryBootstrap,
        refreshProfile,
        updateProfile,
        clearNotice,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function requireAuthToken(state: AuthState): string {
  if (state.status !== "authenticated") {
    throw new Error("Authenticated session is required for this action.");
  }

  return state.token;
}
