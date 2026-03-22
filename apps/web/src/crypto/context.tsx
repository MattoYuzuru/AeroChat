import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { useAuth } from "../auth/useAuth";
import { createCryptoRuntimeClient } from "./runtime-client";
import type { CryptoRuntimeClient, CryptoRuntimeSession } from "./types";
import {
  CryptoRuntimeContext,
  type CryptoContextState,
  type RuntimeAction,
} from "./runtime-context";

export function CryptoRuntimeProvider({ children }: PropsWithChildren) {
  const { state: authState } = useAuth();
  const runtimeRef = useRef<CryptoRuntimeClient | null>(null);
  const mountedRef = useRef(true);
  const currentSessionRef = useRef<CryptoRuntimeSession | null>(null);
  const [state, setState] = useState<CryptoContextState>({
    status: "disabled",
    snapshot: null,
    isActionPending: false,
    pendingLabel: null,
  });

  if (runtimeRef.current === null) {
    runtimeRef.current = createCryptoRuntimeClient();
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      currentSessionRef.current = null;
      setState({
        status: "disabled",
        snapshot: null,
        isActionPending: false,
        pendingLabel: null,
      });
      return;
    }

    const session = {
      token: authState.token,
      profileId: authState.profile.id,
      login: authState.profile.login,
    } satisfies CryptoRuntimeSession;
    currentSessionRef.current = session;

    setState((current) => ({
      status: "bootstrapping",
      snapshot: current.snapshot,
      isActionPending: false,
      pendingLabel: null,
    }));

    void runtimeRef.current
      ?.bootstrapSession(session)
      .then((snapshot) => {
        if (!mountedRef.current) {
          return;
        }

        setState({
          status: "ready",
          snapshot,
          isActionPending: false,
          pendingLabel: null,
        });
      })
      .catch((error) => {
        if (!mountedRef.current) {
          return;
        }

        setState({
          status: "ready",
          snapshot: {
            support: "available",
            phase: "error",
            localDevice: null,
            devices: [],
            linkIntents: [],
            currentBundle: null,
            canCreatePendingDevice: false,
            canApproveLinkIntents: false,
            notice: null,
            errorMessage:
              error instanceof Error && error.message.trim() !== ""
                ? error.message
                : "Не удалось запустить crypto runtime foundation.",
          },
          isActionPending: false,
          pendingLabel: null,
        });
      });
  }, [authState]);

  async function runAction(
    label: string,
    action: RuntimeAction,
  ) {
    if (runtimeRef.current === null || currentSessionRef.current === null) {
      return;
    }

    setState((current) =>
      current.status === "disabled"
        ? current
        : {
            ...current,
            isActionPending: true,
            pendingLabel: label,
          },
    );

    try {
      const snapshot = await action(runtimeRef.current, currentSessionRef.current);
      if (!mountedRef.current) {
        return;
      }

      setState({
        status: "ready",
        snapshot,
        isActionPending: false,
        pendingLabel: null,
      });
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }

      setState((current) => ({
        status: "ready",
        snapshot:
          current.status === "disabled"
            ? null
            : {
                ...(current.snapshot ?? {
                  support: "available",
                  phase: "error" as const,
                  localDevice: null,
                  devices: [],
                  linkIntents: [],
                  currentBundle: null,
                  canCreatePendingDevice: false,
                  canApproveLinkIntents: false,
                  notice: null,
                  errorMessage: null,
                }),
                phase: "error",
                notice: null,
                errorMessage:
                  error instanceof Error && error.message.trim() !== ""
                    ? error.message
                    : "Crypto runtime action завершился с ошибкой.",
              },
        isActionPending: false,
        pendingLabel: null,
      }));
    }
  }

  return (
    <CryptoRuntimeContext.Provider
      value={{
        state,
        refresh() {
          return runAction("Синхронизируем crypto runtime...", (runtime, session) =>
            runtime.bootstrapSession(session),
          );
        },
        createPendingLinkedDevice() {
          return runAction("Создаём pending crypto-device...", (runtime, session) =>
            runtime.createPendingLinkedDevice(session),
          );
        },
        publishCurrentBundle() {
          return runAction("Публикуем текущий bundle...", (runtime, session) =>
            runtime.publishCurrentBundle(session),
          );
        },
        approveLinkIntent(linkIntentId: string) {
          return runAction("Одобряем pending link...", (runtime, session) =>
            runtime.approveLinkIntent(session, linkIntentId),
          );
        },
      }}
    >
      {children}
    </CryptoRuntimeContext.Provider>
  );
}
