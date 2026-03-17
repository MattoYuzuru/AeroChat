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
  | { type: "send_succeeded"; notice: string }
  | { type: "send_finished" }
  | { type: "mutation_started"; login: string; label: string }
  | { type: "mutation_succeeded"; notice: string }
  | { type: "mutation_finished"; login: string }
  | { type: "incoming_request_upserted"; request: FriendRequest }
  | { type: "incoming_request_removed"; login: string }
  | { type: "outgoing_request_upserted"; request: FriendRequest }
  | { type: "outgoing_request_removed"; login: string }
  | { type: "friend_upserted"; friend: Friend }
  | { type: "friend_removed"; login: string }
  | { type: "relationship_cleared"; login: string }
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
    case "send_succeeded":
      return {
        ...state,
        actionErrorMessage: null,
        notice: action.notice,
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
    case "mutation_succeeded":
      return {
        ...state,
        actionErrorMessage: null,
        notice: action.notice,
      };
    case "mutation_finished": {
      const nextPendingLogins = { ...state.pendingLogins };
      delete nextPendingLogins[action.login];

      return {
        ...state,
        pendingLogins: nextPendingLogins,
      };
    }
    case "incoming_request_upserted":
      return {
        ...state,
        status: "ready",
        snapshot: {
          incoming: upsertRequest(state.snapshot.incoming, action.request),
          outgoing: removeRequest(state.snapshot.outgoing, action.request.profile.login),
          friends: removeFriend(state.snapshot.friends, action.request.profile.login),
        },
        screenErrorMessage: null,
        isRefreshing: false,
      };
    case "incoming_request_removed":
      return {
        ...state,
        status: "ready",
        snapshot: {
          ...state.snapshot,
          incoming: removeRequest(state.snapshot.incoming, action.login),
        },
        screenErrorMessage: null,
        isRefreshing: false,
      };
    case "outgoing_request_upserted":
      return {
        ...state,
        status: "ready",
        snapshot: {
          incoming: removeRequest(state.snapshot.incoming, action.request.profile.login),
          outgoing: upsertRequest(state.snapshot.outgoing, action.request),
          friends: removeFriend(state.snapshot.friends, action.request.profile.login),
        },
        screenErrorMessage: null,
        isRefreshing: false,
      };
    case "outgoing_request_removed":
      return {
        ...state,
        status: "ready",
        snapshot: {
          ...state.snapshot,
          outgoing: removeRequest(state.snapshot.outgoing, action.login),
        },
        screenErrorMessage: null,
        isRefreshing: false,
      };
    case "friend_upserted":
      return {
        ...state,
        status: "ready",
        snapshot: {
          incoming: removeRequest(state.snapshot.incoming, action.friend.profile.login),
          outgoing: removeRequest(state.snapshot.outgoing, action.friend.profile.login),
          friends: upsertFriend(state.snapshot.friends, action.friend),
        },
        screenErrorMessage: null,
        isRefreshing: false,
      };
    case "friend_removed":
      return {
        ...state,
        status: "ready",
        snapshot: {
          ...state.snapshot,
          friends: removeFriend(state.snapshot.friends, action.login),
        },
        screenErrorMessage: null,
        isRefreshing: false,
      };
    case "relationship_cleared":
      return {
        ...state,
        status: "ready",
        snapshot: {
          incoming: removeRequest(state.snapshot.incoming, action.login),
          outgoing: removeRequest(state.snapshot.outgoing, action.login),
          friends: removeFriend(state.snapshot.friends, action.login),
        },
        screenErrorMessage: null,
        isRefreshing: false,
      };
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

function upsertRequest(
  items: FriendRequest[],
  request: FriendRequest,
): FriendRequest[] {
  return upsertByLogin(items, request, request.profile.login, (item) => item.profile.login);
}

function upsertFriend(items: Friend[], friend: Friend): Friend[] {
  return upsertByLogin(items, friend, friend.profile.login, (item) => item.profile.login);
}

function removeRequest(items: FriendRequest[], login: string): FriendRequest[] {
  return removeByLogin(items, login, (item) => item.profile.login);
}

function removeFriend(items: Friend[], login: string): Friend[] {
  return removeByLogin(items, login, (item) => item.profile.login);
}

function upsertByLogin<T>(
  items: T[],
  nextItem: T,
  login: string,
  getLogin: (item: T) => string,
): T[] {
  const normalizedLogin = login.trim().toLowerCase();
  const nextItems = items.filter((item) => getLogin(item).trim().toLowerCase() !== normalizedLogin);
  nextItems.unshift(nextItem);

  return nextItems;
}

function removeByLogin<T>(
  items: T[],
  login: string,
  getLogin: (item: T) => string,
): T[] {
  const normalizedLogin = login.trim().toLowerCase();

  return items.filter((item) => getLogin(item).trim().toLowerCase() !== normalizedLogin);
}
