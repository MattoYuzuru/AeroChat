import type { Friend, FriendRequest } from "../gateway/types";

export interface PeopleSnapshot {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  friends: Friend[];
}

export interface PeopleState {
  status: "loading" | "ready" | "error";
  snapshot: PeopleSnapshot;
  screenErrorMessage: string | null;
  actionErrorMessage: string | null;
  notice: string | null;
  isRefreshing: boolean;
  isSendingRequest: boolean;
  pendingLogins: Record<string, string>;
}

type PeopleAction =
  | { type: "load_started" }
  | { type: "load_succeeded"; snapshot: PeopleSnapshot }
  | { type: "load_failed"; message: string }
  | { type: "refresh_started" }
  | { type: "refresh_succeeded"; snapshot: PeopleSnapshot; notice: string | null }
  | { type: "refresh_failed"; message: string }
  | { type: "send_started" }
  | { type: "send_finished" }
  | { type: "mutation_started"; login: string; label: string }
  | { type: "mutation_finished"; login: string }
  | { type: "clear_feedback" };

const emptySnapshot: PeopleSnapshot = {
  incoming: [],
  outgoing: [],
  friends: [],
};

export function createInitialPeopleState(): PeopleState {
  return {
    status: "loading",
    snapshot: emptySnapshot,
    screenErrorMessage: null,
    actionErrorMessage: null,
    notice: null,
    isRefreshing: false,
    isSendingRequest: false,
    pendingLogins: {},
  };
}

export function peopleReducer(
  state: PeopleState,
  action: PeopleAction,
): PeopleState {
  switch (action.type) {
    case "load_started":
      return createInitialPeopleState();
    case "load_succeeded":
      return {
        ...state,
        status: "ready",
        snapshot: action.snapshot,
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
        snapshot: action.snapshot,
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
    case "send_started":
      return {
        ...state,
        isSendingRequest: true,
        actionErrorMessage: null,
        notice: null,
      };
    case "send_finished":
      return {
        ...state,
        isSendingRequest: false,
      };
    case "mutation_started":
      return {
        ...state,
        pendingLogins: {
          ...state.pendingLogins,
          [action.login]: action.label,
        },
        actionErrorMessage: null,
        notice: null,
      };
    case "mutation_finished": {
      const nextPendingLogins = { ...state.pendingLogins };
      delete nextPendingLogins[action.login];

      return {
        ...state,
        pendingLogins: nextPendingLogins,
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
