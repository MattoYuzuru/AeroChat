import type { RtcCall, RtcCallParticipant } from "../gateway/types";

export type GroupCallAwarenessSyncStatus = "idle" | "loading" | "ready" | "error";

export interface GroupCallAwarenessEntry {
  groupId: string;
  call: RtcCall;
  participants: RtcCallParticipant[];
  syncStatus: Exclude<GroupCallAwarenessSyncStatus, "idle">;
  errorMessage: string | null;
}

export interface GroupCallAwarenessState {
  syncStatus: GroupCallAwarenessSyncStatus;
  errorMessage: string | null;
  activeCallsByGroupId: Record<string, GroupCallAwarenessEntry>;
}

export type GroupCallAwarenessAction =
  | { type: "full_sync_started" }
  | {
      type: "full_sync_succeeded";
      activeEntries: GroupCallAwarenessEntry[];
    }
  | { type: "full_sync_failed"; message: string }
  | {
      type: "group_sync_succeeded";
      groupId: string;
      call: RtcCall | null;
      participants: RtcCallParticipant[];
    }
  | { type: "group_sync_failed"; groupId: string; message: string };

export function createInitialGroupCallAwarenessState(): GroupCallAwarenessState {
  return {
    syncStatus: "idle",
    errorMessage: null,
    activeCallsByGroupId: {},
  };
}

export function groupCallAwarenessReducer(
  state: GroupCallAwarenessState,
  action: GroupCallAwarenessAction,
): GroupCallAwarenessState {
  switch (action.type) {
    case "full_sync_started":
      return {
        ...state,
        syncStatus: "loading",
        errorMessage: null,
      };
    case "full_sync_succeeded":
      return {
        syncStatus: "ready",
        errorMessage: null,
        activeCallsByGroupId: toActiveCallsByGroupId(action.activeEntries),
      };
    case "full_sync_failed":
      return {
        ...state,
        syncStatus: "error",
        errorMessage: action.message,
      };
    case "group_sync_succeeded": {
      const nextActiveCallsByGroupId = { ...state.activeCallsByGroupId };

      if (action.call === null || action.call.scope.kind !== "group") {
        delete nextActiveCallsByGroupId[action.groupId];
      } else {
        nextActiveCallsByGroupId[action.groupId] = {
          groupId: action.groupId,
          call: action.call,
          participants: action.participants,
          syncStatus: "ready",
          errorMessage: null,
        };
      }

      return {
        ...state,
        syncStatus: "ready",
        errorMessage: null,
        activeCallsByGroupId: nextActiveCallsByGroupId,
      };
    }
    case "group_sync_failed": {
      const activeEntry = state.activeCallsByGroupId[action.groupId];
      if (activeEntry === undefined) {
        return {
          ...state,
          errorMessage: action.message,
        };
      }

      return {
        ...state,
        errorMessage: action.message,
        activeCallsByGroupId: {
          ...state.activeCallsByGroupId,
          [action.groupId]: {
            ...activeEntry,
            syncStatus: "error",
            errorMessage: action.message,
          },
        },
      };
    }
    default:
      return state;
  }
}

export function selectGroupCallAwarenessEntry(
  state: GroupCallAwarenessState,
  groupId: string | null,
): GroupCallAwarenessEntry | null {
  if (groupId === null) {
    return null;
  }

  return state.activeCallsByGroupId[groupId] ?? null;
}

export function selectGroupCallAwarenessGroupIdsByCallId(
  state: GroupCallAwarenessState,
): Record<string, string> {
  return Object.values(state.activeCallsByGroupId).reduce<Record<string, string>>(
    (result, entry) => {
      result[entry.call.id] = entry.groupId;
      return result;
    },
    {},
  );
}

function toActiveCallsByGroupId(
  entries: GroupCallAwarenessEntry[],
): Record<string, GroupCallAwarenessEntry> {
  return entries.reduce<Record<string, GroupCallAwarenessEntry>>((result, entry) => {
    result[entry.groupId] = entry;
    return result;
  }, {});
}
