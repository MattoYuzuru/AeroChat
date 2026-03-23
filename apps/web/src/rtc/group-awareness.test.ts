import { describe, expect, it } from "vitest";
import {
  createInitialGroupCallAwarenessState,
  groupCallAwarenessReducer,
  selectGroupCallAwarenessEntry,
  selectGroupCallAwarenessGroupIdsByCallId,
  type GroupCallAwarenessEntry,
} from "./group-awareness";

const activeEntry: GroupCallAwarenessEntry = {
  groupId: "group-1",
  call: {
    id: "call-1",
    scope: {
      kind: "group",
      directChatId: null,
      groupId: "group-1",
    },
    createdByUserId: "user-1",
    status: "active",
    activeParticipantCount: 2,
    createdAt: "2026-03-23T10:00:00Z",
    updatedAt: "2026-03-23T10:01:00Z",
    startedAt: "2026-03-23T10:00:00Z",
    endedAt: null,
    endedByUserId: null,
    endReason: "unspecified",
  },
  participants: [
    {
      id: "participant-1",
      callId: "call-1",
      userId: "user-1",
      state: "active",
      joinedAt: "2026-03-23T10:00:00Z",
      leftAt: null,
      updatedAt: "2026-03-23T10:00:00Z",
      lastSignalAt: null,
    },
  ],
  syncStatus: "ready",
  errorMessage: null,
};

describe("groupCallAwarenessReducer", () => {
  it("stores active group calls after full sync", () => {
    const state = groupCallAwarenessReducer(
      createInitialGroupCallAwarenessState(),
      {
        type: "full_sync_succeeded",
        activeEntries: [activeEntry],
      },
    );

    expect(state.syncStatus).toBe("ready");
    expect(selectGroupCallAwarenessEntry(state, "group-1")?.call.id).toBe("call-1");
  });

  it("removes group entry when server no longer reports active call", () => {
    const loadedState = groupCallAwarenessReducer(
      createInitialGroupCallAwarenessState(),
      {
        type: "full_sync_succeeded",
        activeEntries: [activeEntry],
      },
    );

    const state = groupCallAwarenessReducer(loadedState, {
      type: "group_sync_succeeded",
      groupId: "group-1",
      call: null,
      participants: [],
    });

    expect(selectGroupCallAwarenessEntry(state, "group-1")).toBeNull();
  });

  it("keeps call-to-group mapping for participant-triggered refresh", () => {
    const state = groupCallAwarenessReducer(
      createInitialGroupCallAwarenessState(),
      {
        type: "full_sync_succeeded",
        activeEntries: [activeEntry],
      },
    );

    expect(selectGroupCallAwarenessGroupIdsByCallId(state)).toEqual({
      "call-1": "group-1",
    });
  });

  it("marks existing entry with error without dropping active server state", () => {
    const loadedState = groupCallAwarenessReducer(
      createInitialGroupCallAwarenessState(),
      {
        type: "full_sync_succeeded",
        activeEntries: [activeEntry],
      },
    );

    const state = groupCallAwarenessReducer(loadedState, {
      type: "group_sync_failed",
      groupId: "group-1",
      message: "sync failed",
    });

    expect(selectGroupCallAwarenessEntry(state, "group-1")?.syncStatus).toBe("error");
    expect(selectGroupCallAwarenessEntry(state, "group-1")?.errorMessage).toBe("sync failed");
  });
});
