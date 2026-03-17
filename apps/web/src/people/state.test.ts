import { describe, expect, it } from "vitest";
import {
  createInitialPeopleState,
  peopleReducer,
  type PeopleSnapshot,
} from "./state";

const aliceProfile = {
  id: "user-1",
  login: "alice",
  nickname: "Alice",
  avatarUrl: null,
  bio: null,
  timezone: null,
  profileAccent: null,
  statusText: null,
  birthday: null,
  country: null,
  city: null,
  readReceiptsEnabled: true,
  presenceEnabled: true,
  typingVisibilityEnabled: true,
  keyBackupStatus: "KEY_BACKUP_STATUS_NOT_CONFIGURED",
  createdAt: "2026-03-24T09:00:00Z",
  updatedAt: "2026-03-24T09:00:00Z",
};

const snapshot: PeopleSnapshot = {
  incoming: [
    {
      profile: aliceProfile,
      requestedAt: "2026-03-24T10:00:00Z",
    },
  ],
  outgoing: [],
  friends: [],
};

describe("peopleReducer", () => {
  it("preserves snapshot when refresh fails", () => {
    const readyState = peopleReducer(createInitialPeopleState(), {
      type: "load_succeeded",
      snapshot,
    });

    const nextState = peopleReducer(readyState, {
      type: "refresh_failed",
      message: "gateway unavailable",
    });

    expect(nextState.status).toBe("ready");
    expect(nextState.snapshot).toEqual(snapshot);
    expect(nextState.actionErrorMessage).toBe("gateway unavailable");
  });

  it("tracks pending login actions independently from snapshot", () => {
    const readyState = peopleReducer(createInitialPeopleState(), {
      type: "load_succeeded",
      snapshot,
    });

    const pendingState = peopleReducer(readyState, {
      type: "mutation_started",
      login: "alice",
      label: "Принимаем...",
    });
    const finishedState = peopleReducer(pendingState, {
      type: "mutation_finished",
      login: "alice",
    });

    expect(pendingState.pendingLogins).toEqual({
      alice: "Принимаем...",
    });
    expect(finishedState.pendingLogins).toEqual({});
    expect(finishedState.snapshot).toEqual(snapshot);
  });

  it("sets notice on successful refresh after mutation", () => {
    const readyState = peopleReducer(createInitialPeopleState(), {
      type: "load_succeeded",
      snapshot,
    });

    const nextState = peopleReducer(readyState, {
      type: "refresh_succeeded",
      snapshot: {
        incoming: [],
        outgoing: [],
        friends: [
          {
            profile: aliceProfile,
            friendsSince: "2026-03-24T11:00:00Z",
          },
        ],
      },
      notice: "Заявка принята.",
    });

    expect(nextState.notice).toBe("Заявка принята.");
    expect(nextState.snapshot.incoming).toEqual([]);
    expect(nextState.snapshot.friends).toHaveLength(1);
  });

  it("upserts outgoing request idempotently from realtime event", () => {
    const readyState = peopleReducer(createInitialPeopleState(), {
      type: "load_succeeded",
      snapshot: {
        incoming: [],
        outgoing: [],
        friends: [],
      },
    });

    const withRequest = peopleReducer(readyState, {
      type: "outgoing_request_upserted",
      request: {
        profile: aliceProfile,
        requestedAt: "2026-03-24T10:00:00Z",
      },
    });
    const deduplicated = peopleReducer(withRequest, {
      type: "outgoing_request_upserted",
      request: {
        profile: aliceProfile,
        requestedAt: "2026-03-24T10:00:00Z",
      },
    });

    expect(withRequest.snapshot.outgoing).toHaveLength(1);
    expect(deduplicated.snapshot.outgoing).toHaveLength(1);
    expect(deduplicated.snapshot.outgoing[0]?.profile.login).toBe("alice");
  });

  it("moves request into friends when realtime friendship arrives", () => {
    const readyState = peopleReducer(createInitialPeopleState(), {
      type: "load_succeeded",
      snapshot,
    });

    const nextState = peopleReducer(readyState, {
      type: "friend_upserted",
      friend: {
        profile: aliceProfile,
        friendsSince: "2026-03-24T11:00:00Z",
      },
    });

    expect(nextState.snapshot.incoming).toEqual([]);
    expect(nextState.snapshot.outgoing).toEqual([]);
    expect(nextState.snapshot.friends).toEqual([
      {
        profile: aliceProfile,
        friendsSince: "2026-03-24T11:00:00Z",
      },
    ]);
  });

  it("clears all relationship buckets for block-style realtime update", () => {
    const readyState = peopleReducer(createInitialPeopleState(), {
      type: "load_succeeded",
      snapshot: {
        incoming: [
          {
            profile: aliceProfile,
            requestedAt: "2026-03-24T10:00:00Z",
          },
        ],
        outgoing: [
          {
            profile: aliceProfile,
            requestedAt: "2026-03-24T10:00:00Z",
          },
        ],
        friends: [
          {
            profile: aliceProfile,
            friendsSince: "2026-03-24T11:00:00Z",
          },
        ],
      },
    });

    const nextState = peopleReducer(readyState, {
      type: "relationship_cleared",
      login: "alice",
    });

    expect(nextState.snapshot.incoming).toEqual([]);
    expect(nextState.snapshot.outgoing).toEqual([]);
    expect(nextState.snapshot.friends).toEqual([]);
  });
});
