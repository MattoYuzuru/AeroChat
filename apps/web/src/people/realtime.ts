import type { Friend, FriendRequest, Profile } from "../gateway/types";
import type { RealtimeEnvelope } from "../realtime/client";

interface ProfileWire {
  id?: string;
  login?: string;
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  timezone?: string;
  profileAccent?: string;
  statusText?: string;
  birthday?: string;
  country?: string;
  city?: string;
  readReceiptsEnabled?: boolean;
  presenceEnabled?: boolean;
  typingVisibilityEnabled?: boolean;
  keyBackupStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface FriendRequestWire {
  profile?: ProfileWire;
  requestedAt?: string;
}

interface FriendWire {
  profile?: ProfileWire;
  friendsSince?: string;
}

interface PeopleUpdatedPayloadWire {
  reason?: string;
  login?: string;
  request?: FriendRequestWire;
  friend?: FriendWire;
}

export type PeopleRealtimeEvent =
  | { type: "incoming_request_upserted"; request: FriendRequest }
  | { type: "incoming_request_removed"; login: string }
  | { type: "outgoing_request_upserted"; request: FriendRequest }
  | { type: "outgoing_request_removed"; login: string }
  | { type: "friend_upserted"; friend: Friend }
  | { type: "friend_removed"; login: string }
  | { type: "relationship_cleared"; login: string };

export function parsePeopleRealtimeEvent(
  envelope: RealtimeEnvelope,
): PeopleRealtimeEvent | null {
  if (envelope.type !== "people.updated" || !envelope.payload || typeof envelope.payload !== "object") {
    return null;
  }

  const payload = envelope.payload as PeopleUpdatedPayloadWire;
  const reason = typeof payload.reason === "string" ? payload.reason : "";

  switch (reason) {
    case "incoming_request_upsert": {
      const request = normalizeFriendRequest(payload.request);
      if (!request) {
        return null;
      }

      return {
        type: "incoming_request_upserted",
        request,
      };
    }
    case "incoming_request_remove": {
      const login = normalizeLogin(payload.login);
      if (login === "") {
        return null;
      }

      return {
        type: "incoming_request_removed",
        login,
      };
    }
    case "outgoing_request_upsert": {
      const request = normalizeFriendRequest(payload.request);
      if (!request) {
        return null;
      }

      return {
        type: "outgoing_request_upserted",
        request,
      };
    }
    case "outgoing_request_remove": {
      const login = normalizeLogin(payload.login);
      if (login === "") {
        return null;
      }

      return {
        type: "outgoing_request_removed",
        login,
      };
    }
    case "friend_upsert": {
      const friend = normalizeFriend(payload.friend);
      if (!friend) {
        return null;
      }

      return {
        type: "friend_upserted",
        friend,
      };
    }
    case "friend_remove": {
      const login = normalizeLogin(payload.login);
      if (login === "") {
        return null;
      }

      return {
        type: "friend_removed",
        login,
      };
    }
    case "relationship_cleared": {
      const login = normalizeLogin(payload.login);
      if (login === "") {
        return null;
      }

      return {
        type: "relationship_cleared",
        login,
      };
    }
    default:
      return null;
  }
}

function normalizeFriendRequest(input: FriendRequestWire | undefined): FriendRequest | null {
  if (!input) {
    return null;
  }

  const profile = normalizeProfile(input.profile);
  if (profile.login === "") {
    return null;
  }

  return {
    profile,
    requestedAt: input.requestedAt ?? "",
  };
}

function normalizeFriend(input: FriendWire | undefined): Friend | null {
  if (!input) {
    return null;
  }

  const profile = normalizeProfile(input.profile);
  if (profile.login === "") {
    return null;
  }

  return {
    profile,
    friendsSince: input.friendsSince ?? "",
  };
}

function normalizeProfile(input: ProfileWire | undefined): Profile {
  return {
    id: input?.id ?? "",
    login: normalizeLogin(input?.login),
    nickname: input?.nickname ?? "",
    avatarUrl: normalizeNullableString(input?.avatarUrl),
    bio: normalizeNullableString(input?.bio),
    timezone: normalizeNullableString(input?.timezone),
    profileAccent: normalizeNullableString(input?.profileAccent),
    statusText: normalizeNullableString(input?.statusText),
    birthday: normalizeNullableString(input?.birthday),
    country: normalizeNullableString(input?.country),
    city: normalizeNullableString(input?.city),
    readReceiptsEnabled: input?.readReceiptsEnabled ?? false,
    presenceEnabled: input?.presenceEnabled ?? false,
    typingVisibilityEnabled: input?.typingVisibilityEnabled ?? false,
    keyBackupStatus: input?.keyBackupStatus ?? "KEY_BACKUP_STATUS_UNSPECIFIED",
    createdAt: input?.createdAt ?? "",
    updatedAt: input?.updatedAt ?? "",
  };
}

function normalizeNullableString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value === "" ? null : value;
}

function normalizeLogin(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}
