import { describe, expect, it } from "vitest";
import { parsePeopleRealtimeEvent } from "./realtime";

describe("parsePeopleRealtimeEvent", () => {
  it("normalizes incoming request upsert payload", () => {
    const event = parsePeopleRealtimeEvent({
      id: "evt-1",
      type: "people.updated",
      issuedAt: "2026-04-07T12:00:00Z",
      payload: {
        reason: "incoming_request_upsert",
        request: {
          profile: {
            id: "user-1",
            login: "Alice",
            nickname: "Alice",
            readReceiptsEnabled: true,
            presenceEnabled: true,
            typingVisibilityEnabled: true,
            keyBackupStatus: "KEY_BACKUP_STATUS_NOT_CONFIGURED",
            createdAt: "2026-04-07T11:59:00Z",
            updatedAt: "2026-04-07T11:59:00Z",
          },
          requestedAt: "2026-04-07T12:00:00Z",
        },
      },
    });

    expect(event).toEqual({
      type: "incoming_request_upserted",
      request: expect.objectContaining({
        requestedAt: "2026-04-07T12:00:00Z",
        profile: expect.objectContaining({
          login: "alice",
          nickname: "Alice",
        }),
      }),
    });
  });

  it("normalizes friend removal payload", () => {
    const event = parsePeopleRealtimeEvent({
      id: "evt-2",
      type: "people.updated",
      issuedAt: "2026-04-07T12:01:00Z",
      payload: {
        reason: "friend_remove",
        login: " Bob ",
      },
    });

    expect(event).toEqual({
      type: "friend_removed",
      login: "bob",
    });
  });

  it("ignores malformed payloads", () => {
    const event = parsePeopleRealtimeEvent({
      id: "evt-3",
      type: "people.updated",
      issuedAt: "2026-04-07T12:02:00Z",
      payload: {
        reason: "friend_upsert",
      },
    });

    expect(event).toBeNull();
  });
});
