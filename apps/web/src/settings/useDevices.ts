import { useEffect, useReducer, useRef } from "react";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  type DeviceWithSessions,
  type RevokeSessionOrDeviceTarget,
} from "../gateway/types";
import {
  createInitialDevicesState,
  devicesReducer,
} from "./devices-state";

interface UseDevicesOptions {
  enabled: boolean;
  token: string;
  onUnauthenticated(message?: string): void;
}

interface RevocationOptions {
  target: RevokeSessionOrDeviceTarget;
  pendingLabel: string;
  successMessage: string;
  fallbackMessage: string;
}

export function useDevices({
  enabled,
  token,
  onUnauthenticated,
}: UseDevicesOptions) {
  const [state, dispatch] = useReducer(
    devicesReducer,
    undefined,
    createInitialDevicesState,
  );
  const mountedRef = useRef(false);
  const onUnauthenticatedRef = useRef(onUnauthenticated);

  useEffect(() => {
    onUnauthenticatedRef.current = onUnauthenticated;
  }, [onUnauthenticated]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    mountedRef.current = true;
    void loadInitialDevices(token, onUnauthenticatedRef, mountedRef, dispatch);

    return () => {
      mountedRef.current = false;
    };
  }, [enabled, token]);

  async function reload() {
    if (state.status === "loading") {
      return;
    }

    if (state.status === "error") {
      await loadInitialDevices(token, onUnauthenticatedRef, mountedRef, dispatch);
      return;
    }

    dispatch({ type: "refresh_started" });

    try {
      const devices = await gatewayClient.listDevices(token);
      if (!mountedRef.current) {
        return;
      }

      dispatch({
        type: "refresh_succeeded",
        devices,
        notice: null,
      });
    } catch (error) {
      const message = resolveProtectedError(
        error,
        "Не удалось обновить список устройств через gateway.",
        onUnauthenticatedRef,
      );
      if (!mountedRef.current || message === null) {
        return;
      }

      dispatch({ type: "refresh_failed", message });
    }
  }

  async function revokeDevice(deviceId: string) {
    return runRevocation(
      token,
      onUnauthenticatedRef,
      mountedRef,
      dispatch,
      {
        target: {
          kind: "device",
          deviceId,
        },
        pendingLabel: "Отзываем устройство...",
        successMessage: "Устройство отозвано.",
        fallbackMessage: "Не удалось отозвать устройство.",
      },
    );
  }

  async function revokeSession(sessionId: string) {
    return runRevocation(
      token,
      onUnauthenticatedRef,
      mountedRef,
      dispatch,
      {
        target: {
          kind: "session",
          sessionId,
        },
        pendingLabel: "Закрываем сессию...",
        successMessage: "Сессия отозвана.",
        fallbackMessage: "Не удалось отозвать сессию.",
      },
    );
  }

  return {
    state,
    reload,
    revokeDevice,
    revokeSession,
    clearFeedback() {
      dispatch({ type: "clear_feedback" });
    },
  };
}

type DevicesDispatch = (action: Parameters<typeof devicesReducer>[1]) => void;

async function loadInitialDevices(
  token: string,
  onUnauthenticatedRef: { current: (message?: string) => void },
  mountedRef: { current: boolean },
  dispatch: DevicesDispatch,
) {
  dispatch({ type: "load_started" });

  try {
    const devices = await gatewayClient.listDevices(token);
    if (!mountedRef.current) {
      return;
    }

    dispatch({ type: "load_succeeded", devices });
  } catch (error) {
    const message = resolveProtectedError(
      error,
      "Не удалось загрузить список устройств через gateway.",
      onUnauthenticatedRef,
    );
    if (!mountedRef.current || message === null) {
      return;
    }

    dispatch({ type: "load_failed", message });
  }
}

async function runRevocation(
  token: string,
  onUnauthenticatedRef: { current: (message?: string) => void },
  mountedRef: { current: boolean },
  dispatch: DevicesDispatch,
  options: RevocationOptions,
): Promise<boolean> {
  dispatch({ type: "clear_feedback" });
  dispatch({
    type: "revoke_started",
    target: options.target,
    label: options.pendingLabel,
  });

  try {
    await gatewayClient.revokeSessionOrDevice(token, options.target);
    if (!mountedRef.current) {
      return false;
    }

    dispatch({ type: "refresh_started" });
    const devices = await gatewayClient.listDevices(token);
    if (!mountedRef.current) {
      return false;
    }

    dispatch({
      type: "refresh_succeeded",
      devices,
      notice: options.successMessage,
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

    dispatch({ type: "refresh_failed", message });
    return false;
  } finally {
    if (mountedRef.current) {
      dispatch({
        type: "revoke_finished",
        target: options.target,
      });
    }
  }
}

function resolveProtectedError(
  error: unknown,
  fallbackMessage: string,
  onUnauthenticatedRef: { current: (message?: string) => void },
): string | null {
  if (isGatewayErrorCode(error, "unauthenticated")) {
    onUnauthenticatedRef.current("Текущая сессия больше недействительна. Войдите снова.");
    return null;
  }

  return describeGatewayError(error, fallbackMessage);
}

export function countActiveDevices(devices: DeviceWithSessions[]): number {
  return devices.filter((entry) => entry.device.revokedAt === null).length;
}

export function countActiveSessions(devices: DeviceWithSessions[]): number {
  return devices.reduce((total, entry) => {
    const activeSessions = entry.sessions.filter((session) => session.revokedAt === null);
    return total + activeSessions.length;
  }, 0);
}
