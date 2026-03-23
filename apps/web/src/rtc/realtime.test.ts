import { describe, expect, it } from "vitest";
import { parseRTCRealtimeEvent } from "./realtime";

describe("parseRTCRealtimeEvent", () => {
  it("normalizes rtc.call.updated payload", () => {
    const event = parseRTCRealtimeEvent({
      id: "evt-rtc-call-1",
      type: "rtc.call.updated",
      issuedAt: "2026-03-23T10:00:00Z",
      payload: {
        call: {
          id: "call-1",
          scope: {
            type: "CONVERSATION_SCOPE_TYPE_DIRECT",
            directChatId: "chat-1",
          },
          createdByUserId: "user-1",
          status: "CALL_STATUS_ACTIVE",
          activeParticipantCount: 1,
          createdAt: "2026-03-23T10:00:00Z",
          updatedAt: "2026-03-23T10:00:00Z",
          startedAt: "2026-03-23T10:00:00Z",
        },
      },
    });

    expect(event).toEqual({
      type: "rtc.call.updated",
      call: {
        id: "call-1",
        scope: {
          kind: "direct",
          directChatId: "chat-1",
          groupId: null,
        },
        createdByUserId: "user-1",
        status: "active",
        activeParticipantCount: 1,
        createdAt: "2026-03-23T10:00:00Z",
        updatedAt: "2026-03-23T10:00:00Z",
        startedAt: "2026-03-23T10:00:00Z",
        endedAt: null,
        endedByUserId: null,
        endReason: "unspecified",
      },
    });
  });

  it("normalizes rtc.participant.updated payload", () => {
    const event = parseRTCRealtimeEvent({
      id: "evt-rtc-participant-1",
      type: "rtc.participant.updated",
      issuedAt: "2026-03-23T10:00:05Z",
      payload: {
        callId: "call-1",
        participant: {
          id: "participant-1",
          callId: "call-1",
          userId: "user-2",
          state: "PARTICIPANT_STATE_ACTIVE",
          joinedAt: "2026-03-23T10:00:05Z",
          updatedAt: "2026-03-23T10:00:05Z",
        },
      },
    });

    expect(event).toEqual({
      type: "rtc.participant.updated",
      callId: "call-1",
      participant: {
        id: "participant-1",
        callId: "call-1",
        userId: "user-2",
        state: "active",
        joinedAt: "2026-03-23T10:00:05Z",
        leftAt: null,
        updatedAt: "2026-03-23T10:00:05Z",
        lastSignalAt: null,
      },
    });
  });

  it("normalizes rtc.signal.received payload and decodes opaque bytes", () => {
    const event = parseRTCRealtimeEvent({
      id: "evt-rtc-signal-1",
      type: "rtc.signal.received",
      issuedAt: "2026-03-23T10:00:06Z",
      payload: {
        signal: {
          callId: "call-1",
          fromUserId: "user-1",
          targetUserId: "user-2",
          type: "SIGNAL_ENVELOPE_TYPE_OFFER",
          payload: "eyJ0eXBlIjoib2ZmZXIifQ==",
          createdAt: "2026-03-23T10:00:06Z",
        },
      },
    });

    expect(event?.type).toBe("rtc.signal.received");
    expect(event && event.type === "rtc.signal.received" && new TextDecoder().decode(event.signal.payload)).toBe(
      "{\"type\":\"offer\"}",
    );
  });

  it("ignores malformed rtc payloads", () => {
    expect(
      parseRTCRealtimeEvent({
        id: "evt-rtc-bad-1",
        type: "rtc.call.updated",
        issuedAt: "2026-03-23T10:00:00Z",
        payload: {},
      }),
    ).toBeNull();
  });
});
