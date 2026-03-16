import { describe, expect, it } from "vitest";
import {
  createInitialDevicesState,
  devicesReducer,
  getRevocationTargetKey,
} from "./devices-state";
import type { DeviceWithSessions } from "../gateway/types";

const devices: DeviceWithSessions[] = [
  {
    device: {
      id: "device-1",
      label: "Web Chrome",
      createdAt: "2026-03-28T10:00:00Z",
      lastSeenAt: "2026-03-28T12:00:00Z",
      revokedAt: null,
    },
    sessions: [
      {
        id: "session-1",
        deviceId: "device-1",
        createdAt: "2026-03-28T10:00:00Z",
        lastSeenAt: "2026-03-28T12:00:00Z",
        revokedAt: null,
      },
    ],
  },
];

describe("devicesReducer", () => {
  it("stores loaded device snapshot", () => {
    const nextState = devicesReducer(createInitialDevicesState(), {
      type: "load_succeeded",
      devices,
    });

    expect(nextState.status).toBe("ready");
    expect(nextState.devices).toEqual(devices);
    expect(nextState.screenErrorMessage).toBeNull();
  });

  it("tracks per-target pending revoke actions independently", () => {
    const readyState = devicesReducer(createInitialDevicesState(), {
      type: "load_succeeded",
      devices,
    });

    const pendingState = devicesReducer(readyState, {
      type: "revoke_started",
      target: {
        kind: "session",
        sessionId: "session-1",
      },
      label: "Закрываем сессию...",
    });
    const finishedState = devicesReducer(pendingState, {
      type: "revoke_finished",
      target: {
        kind: "session",
        sessionId: "session-1",
      },
    });

    expect(pendingState.pendingTargets).toEqual({
      [getRevocationTargetKey({ kind: "session", sessionId: "session-1" })]:
        "Закрываем сессию...",
    });
    expect(finishedState.pendingTargets).toEqual({});
    expect(finishedState.devices).toEqual(devices);
  });

  it("keeps device snapshot when refresh fails after a revoke", () => {
    const readyState = devicesReducer(createInitialDevicesState(), {
      type: "load_succeeded",
      devices,
    });

    const nextState = devicesReducer(readyState, {
      type: "refresh_failed",
      message: "gateway unavailable",
    });

    expect(nextState.status).toBe("ready");
    expect(nextState.devices).toEqual(devices);
    expect(nextState.actionErrorMessage).toBe("gateway unavailable");
  });
});
