import { describe, expect, it } from "vitest";
import type { Profile } from "../gateway/types";
import {
  describePersonRelationshipState,
  describePersonProfileSummary,
  findExactKnownPeopleEntries,
  findSimilarKnownPeopleEntries,
  getPersonProfileLaunchTitle,
  listKnownPeopleEntries,
  resolvePersonProfileEntry,
} from "./profile-model";
import type { PeopleSnapshot } from "./state";

describe("resolvePersonProfileEntry", () => {
  it("prefers friend relationship for the canonical person target", () => {
    const snapshot = createPeopleSnapshot();

    const entry = resolvePersonProfileEntry(snapshot, "user-1");

    expect(entry).not.toBeNull();
    expect(entry?.relationshipKind).toBe("friend");
    expect(entry?.friendsSince).toBe("2026-03-01T10:00:00Z");
  });
});

describe("findExactKnownPeopleEntries", () => {
  it("matches only exact known logins and keeps stronger relationship first", () => {
    const snapshot = createPeopleSnapshot();

    const entries = findExactKnownPeopleEntries(snapshot, "@alice");

    expect(entries).toHaveLength(1);
    expect(entries[0]?.profile.id).toBe("user-1");
    expect(entries[0]?.relationshipKind).toBe("friend");
  });

  it("does not turn arbitrary text into people discovery", () => {
    const snapshot = createPeopleSnapshot();

    expect(findExactKnownPeopleEntries(snapshot, "ali")).toEqual([]);
    expect(findExactKnownPeopleEntries(snapshot, "release notes")).toEqual([]);
  });
});

describe("known people helpers", () => {
  it("keeps similar results bounded to already known contacts", () => {
    const snapshot = createPeopleSnapshot();

    expect(findSimilarKnownPeopleEntries(snapshot, "ali")).toEqual([
      expect.objectContaining({
        profile: expect.objectContaining({ id: "user-1", login: "alice" }),
        relationshipKind: "friend",
      }),
    ]);
  });

  it("builds a stable known-people list without public discovery drift", () => {
    const snapshot = createPeopleSnapshot();

    expect(listKnownPeopleEntries(snapshot, 5).map((entry) => entry.profile.login)).toEqual([
      "alice",
      "bob",
    ]);
  });
});

describe("person profile text helpers", () => {
  it("builds stable launch titles and summaries from existing profile fields", () => {
    const profile = createProfile({
      id: "user-4",
      login: "carol",
      nickname: "Carol",
      statusText: "online",
      bio: null,
      city: null,
      country: null,
    });

    expect(getPersonProfileLaunchTitle(profile)).toBe("Carol");
    expect(describePersonProfileSummary(profile)).toBe("online");
  });

  it("keeps relationship state labels stable across person-facing surfaces", () => {
    expect(describePersonRelationshipState("friend")).toBe("Друг");
    expect(describePersonRelationshipState("incoming_request")).toBe("Входящая заявка");
    expect(describePersonRelationshipState("outgoing_request")).toBe("Исходящая заявка");
  });
});

function createPeopleSnapshot(): PeopleSnapshot {
  return {
    friends: [
      {
        profile: createProfile({
          id: "user-1",
          login: "alice",
          nickname: "Alice",
        }),
        friendsSince: "2026-03-01T10:00:00Z",
      },
    ],
    incoming: [
      {
        profile: createProfile({
          id: "user-2",
          login: "bob",
          nickname: "Bob",
        }),
        requestedAt: "2026-03-02T11:00:00Z",
      },
    ],
    outgoing: [
      {
        profile: createProfile({
          id: "user-1",
          login: "alice",
          nickname: "Alice Pending",
        }),
        requestedAt: "2026-03-03T12:00:00Z",
      },
    ],
  };
}

function createProfile(
  overrides: Partial<Profile> & Pick<Profile, "id" | "login" | "nickname">,
): Profile {
  return {
    id: overrides.id,
    login: overrides.login,
    nickname: overrides.nickname,
    avatarUrl: overrides.avatarUrl ?? null,
    bio: overrides.bio ?? "Bio",
    timezone: overrides.timezone ?? null,
    profileAccent: overrides.profileAccent ?? null,
    statusText: overrides.statusText ?? null,
    birthday: overrides.birthday ?? null,
    country: overrides.country ?? "Россия",
    city: overrides.city ?? "Москва",
    readReceiptsEnabled: overrides.readReceiptsEnabled ?? true,
    presenceEnabled: overrides.presenceEnabled ?? true,
    typingVisibilityEnabled: overrides.typingVisibilityEnabled ?? true,
    keyBackupStatus: overrides.keyBackupStatus ?? "KEY_BACKUP_STATUS_CONFIGURED",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-03-01T00:00:00Z",
  };
}
