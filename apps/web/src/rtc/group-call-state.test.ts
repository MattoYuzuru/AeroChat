import { describe, expect, it } from "vitest";
import {
  canActivelyParticipateInGroupCall,
  deriveGroupCallActionAvailability,
  deriveGroupCallUiPhase,
  describeGroupCallConflictMessage,
} from "./group-call-state";

const activeCall = {
  id: "call-1",
  scope: {
    kind: "group" as const,
    directChatId: null,
    groupId: "group-1",
  },
  createdByUserId: "user-1",
  status: "active" as const,
  activeParticipantCount: 2,
  createdAt: "2026-03-23T10:00:00Z",
  updatedAt: "2026-03-23T10:01:00Z",
  startedAt: "2026-03-23T10:00:00Z",
  endedAt: null,
  endedByUserId: null,
  endReason: "unspecified" as const,
};

const selfParticipant = {
  id: "participant-1",
  callId: "call-1",
  userId: "user-1",
  state: "active" as const,
  joinedAt: "2026-03-23T10:00:00Z",
  leftAt: null,
  updatedAt: "2026-03-23T10:00:00Z",
  lastSignalAt: null,
};

describe("group-call-state", () => {
  it("keeps reader in read-only mode", () => {
    expect(canActivelyParticipateInGroupCall("reader")).toBe(false);

    expect(
      deriveGroupCallActionAvailability({
        actionState: "idle",
        call: activeCall,
        currentUserId: "user-1",
        selfParticipant: null,
        selfRole: "reader",
      }),
    ).toEqual({
      canStart: false,
      canJoin: false,
      canLeave: false,
      canEnd: false,
      isReadOnly: true,
    });
  });

  it("allows member to start or join according to current server state", () => {
    expect(
      deriveGroupCallActionAvailability({
        actionState: "idle",
        call: null,
        currentUserId: "user-1",
        selfParticipant: null,
        selfRole: "member",
      }).canStart,
    ).toBe(true);

    expect(
      deriveGroupCallActionAvailability({
        actionState: "idle",
        call: activeCall,
        currentUserId: "user-2",
        selfParticipant: null,
        selfRole: "member",
      }).canJoin,
    ).toBe(true);
  });

  it("derives joined and observing phases from server-backed participant state", () => {
    expect(
      deriveGroupCallUiPhase({
        actionState: "idle",
        call: activeCall,
        selfParticipant,
        terminalState: "idle",
      }),
    ).toBe("joined");

    expect(
      deriveGroupCallUiPhase({
        actionState: "idle",
        call: activeCall,
        selfParticipant: null,
        terminalState: "idle",
      }),
    ).toBe("observing");
  });

  it("returns bounded conflict copy for group UI", () => {
    expect(describeGroupCallConflictMessage("start")).toContain("Нельзя начать");
    expect(describeGroupCallConflictMessage("join")).toContain("Нельзя присоединиться");
  });
});
