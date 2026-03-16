import type {
  DeviceWithSessions,
  RevokeSessionOrDeviceTarget,
} from "../gateway/types";

export interface DevicesState {
  status: "loading" | "ready" | "error";
  devices: DeviceWithSessions[];
  screenErrorMessage: string | null;
  actionErrorMessage: string | null;
  notice: string | null;
  isRefreshing: boolean;
  pendingTargets: Record<string, string>;
}

type DevicesAction =
  | { type: "load_started" }
  | { type: "load_succeeded"; devices: DeviceWithSessions[] }
  | { type: "load_failed"; message: string }
  | { type: "refresh_started" }
  | { type: "refresh_succeeded"; devices: DeviceWithSessions[]; notice: string | null }
  | { type: "refresh_failed"; message: string }
  | { type: "revoke_started"; target: RevokeSessionOrDeviceTarget; label: string }
  | { type: "revoke_finished"; target: RevokeSessionOrDeviceTarget }
  | { type: "clear_feedback" };

export function createInitialDevicesState(): DevicesState {
  return {
    status: "loading",
    devices: [],
    screenErrorMessage: null,
    actionErrorMessage: null,
    notice: null,
    isRefreshing: false,
    pendingTargets: {},
  };
}

export function devicesReducer(
  state: DevicesState,
  action: DevicesAction,
): DevicesState {
  switch (action.type) {
    case "load_started":
      return createInitialDevicesState();
    case "load_succeeded":
      return {
        ...state,
        status: "ready",
        devices: action.devices,
        screenErrorMessage: null,
        actionErrorMessage: null,
        notice: null,
        isRefreshing: false,
      };
    case "load_failed":
      return {
        ...state,
        status: "error",
        screenErrorMessage: action.message,
        actionErrorMessage: null,
        notice: null,
        isRefreshing: false,
      };
    case "refresh_started":
      return {
        ...state,
        isRefreshing: true,
        actionErrorMessage: null,
        notice: null,
      };
    case "refresh_succeeded":
      return {
        ...state,
        status: "ready",
        devices: action.devices,
        screenErrorMessage: null,
        actionErrorMessage: null,
        notice: action.notice,
        isRefreshing: false,
      };
    case "refresh_failed":
      return {
        ...state,
        status: "ready",
        actionErrorMessage: action.message,
        notice: null,
        isRefreshing: false,
      };
    case "revoke_started":
      return {
        ...state,
        pendingTargets: {
          ...state.pendingTargets,
          [getRevocationTargetKey(action.target)]: action.label,
        },
        actionErrorMessage: null,
        notice: null,
      };
    case "revoke_finished": {
      const nextPendingTargets = { ...state.pendingTargets };
      delete nextPendingTargets[getRevocationTargetKey(action.target)];

      return {
        ...state,
        pendingTargets: nextPendingTargets,
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

export function getRevocationTargetKey(
  target: RevokeSessionOrDeviceTarget,
): string {
  if (target.kind === "session") {
    return `session:${target.sessionId}`;
  }

  return `device:${target.deviceId}`;
}
