import type { Friend, FriendRequest, Profile } from "../gateway/types";
import type { PeopleSnapshot } from "./state";

export type PersonProfileRelationshipKind =
  | "friend"
  | "incoming_request"
  | "outgoing_request";

export interface PersonProfileEntry {
  profile: Profile;
  relationshipKind: PersonProfileRelationshipKind;
  friendsSince: string | null;
  requestedAt: string | null;
}

const relationshipPriority: Record<PersonProfileRelationshipKind, number> = {
  friend: 3,
  incoming_request: 2,
  outgoing_request: 1,
};

export function resolvePersonProfileEntry(
  snapshot: PeopleSnapshot,
  userId: string,
): PersonProfileEntry | null {
  const normalizedUserId = userId.trim();
  if (normalizedUserId === "") {
    return null;
  }

  const friend = snapshot.friends.find((item) => item.profile.id === normalizedUserId) ?? null;
  if (friend !== null) {
    return mapFriendToPersonProfileEntry(friend);
  }

  const incoming =
    snapshot.incoming.find((item) => item.profile.id === normalizedUserId) ?? null;
  if (incoming !== null) {
    return mapIncomingRequestToPersonProfileEntry(incoming);
  }

  const outgoing =
    snapshot.outgoing.find((item) => item.profile.id === normalizedUserId) ?? null;
  if (outgoing !== null) {
    return mapOutgoingRequestToPersonProfileEntry(outgoing);
  }

  return null;
}

export function findExactKnownPeopleEntries(
  snapshot: PeopleSnapshot,
  query: string,
): PersonProfileEntry[] {
  const normalizedLogin = normalizeExactLoginQuery(query);
  if (normalizedLogin === "") {
    return [];
  }

  const entries = new Map<string, PersonProfileEntry>();

  for (const friend of snapshot.friends) {
    upsertPersonProfileEntry(entries, mapFriendToPersonProfileEntry(friend), normalizedLogin);
  }

  for (const request of snapshot.incoming) {
    upsertPersonProfileEntry(
      entries,
      mapIncomingRequestToPersonProfileEntry(request),
      normalizedLogin,
    );
  }

  for (const request of snapshot.outgoing) {
    upsertPersonProfileEntry(
      entries,
      mapOutgoingRequestToPersonProfileEntry(request),
      normalizedLogin,
    );
  }

  return [...entries.values()].sort((left, right) => {
    return comparePersonEntries(left, right);
  });
}

export function findSimilarKnownPeopleEntries(
  snapshot: PeopleSnapshot,
  query: string,
  limit = 5,
): PersonProfileEntry[] {
  const normalizedQuery = normalizeExactLoginQuery(query);
  if (normalizedQuery.length < 2) {
    return [];
  }

  return collectKnownPeopleEntries(snapshot)
    .filter((entry) => {
      const login = entry.profile.login.trim().toLowerCase();
      const nickname = entry.profile.nickname.trim().toLowerCase();
      return (
        login !== normalizedQuery &&
        (login.includes(normalizedQuery) || nickname.includes(normalizedQuery))
      );
    })
    .slice(0, limit);
}

export function listKnownPeopleEntries(
  snapshot: PeopleSnapshot,
  limit = 6,
): PersonProfileEntry[] {
  return collectKnownPeopleEntries(snapshot).slice(0, limit);
}

export function getPersonProfileLaunchTitle(profile: Profile): string {
  const nickname = profile.nickname.trim();
  if (nickname !== "") {
    return nickname;
  }

  const login = profile.login.trim();
  if (login !== "") {
    return `@${login}`;
  }

  return "Профиль контакта";
}

export function describePersonProfileSummary(profile: Profile): string {
  if (profile.statusText && profile.statusText.trim() !== "") {
    return profile.statusText;
  }

  if (profile.bio && profile.bio.trim() !== "") {
    return profile.bio;
  }

  if (profile.city && profile.country) {
    return `${profile.city}, ${profile.country}`;
  }

  if (profile.city) {
    return profile.city;
  }

  if (profile.country) {
    return profile.country;
  }

  return "Базовый social graph-контакт без публичного discovery.";
}

export function describePersonRelationship(entry: PersonProfileEntry): string {
  switch (entry.relationshipKind) {
    case "friend":
      return entry.friendsSince === null
        ? "Друг"
        : `Друзья с ${formatDateTime(entry.friendsSince)}`;
    case "incoming_request":
      return entry.requestedAt === null
        ? "Входящая заявка"
        : `Входящая заявка с ${formatDateTime(entry.requestedAt)}`;
    case "outgoing_request":
      return entry.requestedAt === null
        ? "Исходящая заявка"
        : `Исходящая заявка с ${formatDateTime(entry.requestedAt)}`;
    default:
      return "Контакт";
  }
}

export function normalizeExactLoginQuery(query: string): string {
  const normalized = query.trim().toLowerCase();
  if (normalized.startsWith("@")) {
    return normalized.slice(1);
  }

  return normalized;
}

function upsertPersonProfileEntry(
  entries: Map<string, PersonProfileEntry>,
  entry: PersonProfileEntry,
  normalizedLogin: string,
) {
  if (entry.profile.login.trim().toLowerCase() !== normalizedLogin) {
    return;
  }

  const entryKey = entry.profile.id.trim() || entry.profile.login.trim().toLowerCase();
  const currentEntry = entries.get(entryKey) ?? null;
  if (
    currentEntry !== null &&
    relationshipPriority[currentEntry.relationshipKind] >=
      relationshipPriority[entry.relationshipKind]
  ) {
    return;
  }

  entries.set(entryKey, entry);
}

function collectKnownPeopleEntries(snapshot: PeopleSnapshot): PersonProfileEntry[] {
  const entries = new Map<string, PersonProfileEntry>();

  for (const friend of snapshot.friends) {
    upsertKnownPersonEntry(entries, mapFriendToPersonProfileEntry(friend));
  }

  for (const request of snapshot.incoming) {
    upsertKnownPersonEntry(entries, mapIncomingRequestToPersonProfileEntry(request));
  }

  for (const request of snapshot.outgoing) {
    upsertKnownPersonEntry(entries, mapOutgoingRequestToPersonProfileEntry(request));
  }

  return [...entries.values()].sort((left, right) => comparePersonEntries(left, right));
}

function upsertKnownPersonEntry(
  entries: Map<string, PersonProfileEntry>,
  entry: PersonProfileEntry,
) {
  const entryKey = entry.profile.id.trim() || entry.profile.login.trim().toLowerCase();
  const currentEntry = entries.get(entryKey) ?? null;
  if (
    currentEntry !== null &&
    relationshipPriority[currentEntry.relationshipKind] >=
      relationshipPriority[entry.relationshipKind]
  ) {
    return;
  }

  entries.set(entryKey, entry);
}

function comparePersonEntries(left: PersonProfileEntry, right: PersonProfileEntry): number {
  const priorityDelta =
    relationshipPriority[right.relationshipKind] -
    relationshipPriority[left.relationshipKind];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return left.profile.login.localeCompare(right.profile.login, "ru-RU");
}

function mapFriendToPersonProfileEntry(friend: Friend): PersonProfileEntry {
  return {
    profile: friend.profile,
    relationshipKind: "friend",
    friendsSince: friend.friendsSince,
    requestedAt: null,
  };
}

function mapIncomingRequestToPersonProfileEntry(request: FriendRequest): PersonProfileEntry {
  return {
    profile: request.profile,
    relationshipKind: "incoming_request",
    friendsSince: null,
    requestedAt: request.requestedAt,
  };
}

function mapOutgoingRequestToPersonProfileEntry(request: FriendRequest): PersonProfileEntry {
  return {
    profile: request.profile,
    relationshipKind: "outgoing_request",
    friendsSince: null,
    requestedAt: request.requestedAt,
  };
}

function formatDateTime(value: string): string {
  if (value.trim() === "") {
    return "неизвестно";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
