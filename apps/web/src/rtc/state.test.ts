import { describe, expect, it } from "vitest";
import {
  createInitialDirectCallState,
  deriveDirectCallUiPhase,
  directCallReducer,
  selectDirectCallRemoteParticipant,
  selectDirectCallSelfParticipant,
} from "./state";

describe("directCallReducer", () => {
  it("marks ended terminal state when active call disappears after sync", () => {
    const readyState = directCallReducer(createInitialDirectCallState(), {
      type: "sync_succeeded",
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
      participants: [],
    });

    const nextState = directCallReducer(readyState, {
      type: "sync_succeeded",
      call: null,
      participants: [],
    });

    expect(nextState.terminalState).toBe("ended");
    expect(deriveDirectCallUiPhase(nextState, "user-1")).toBe("ended");
  });

  it("exposes remote and self participant presence from authoritative active list", () => {
    const readyState = directCallReducer(createInitialDirectCallState(), {
      type: "sync_succeeded",
      call: {
        id: "call-1",
        scope: {
          kind: "direct",
          directChatId: "chat-1",
          groupId: null,
        },
        createdByUserId: "user-1",
        status: "active",
        activeParticipantCount: 2,
        createdAt: "2026-03-23T10:00:00Z",
        updatedAt: "2026-03-23T10:00:00Z",
        startedAt: "2026-03-23T10:00:00Z",
        endedAt: null,
        endedByUserId: null,
        endReason: "unspecified",
      },
      participants: [
        {
          id: "participant-1",
          callId: "call-1",
          userId: "user-1",
          state: "active",
          joinedAt: "2026-03-23T10:00:00Z",
          leftAt: null,
          updatedAt: "2026-03-23T10:00:00Z",
          lastSignalAt: null,
        },
        {
          id: "participant-2",
          callId: "call-1",
          userId: "user-2",
          state: "active",
          joinedAt: "2026-03-23T10:00:02Z",
          leftAt: null,
          updatedAt: "2026-03-23T10:00:02Z",
          lastSignalAt: null,
        },
      ],
    });

    expect(selectDirectCallSelfParticipant(readyState, "user-1")?.id).toBe("participant-1");
    expect(selectDirectCallRemoteParticipant(readyState, "user-1")?.id).toBe("participant-2");
  });

  it("tracks failed peer connection as terminal failure", () => {
    const nextState = directCallReducer(createInitialDirectCallState(), {
      type: "peer_state_replaced",
      peerConnectionState: "failed",
      message: "rtc failed",
    });

    expect(nextState.terminalState).toBe("failed");
    expect(nextState.errorMessage).toBe("rtc failed");
    expect(deriveDirectCallUiPhase(nextState, "user-1")).toBe("failed");
  });

  it("switches to connected phase when peer connection is established", () => {
    const readyState = directCallReducer(createInitialDirectCallState(), {
      type: "sync_succeeded",
      call: {
        id: "call-1",
        scope: {
          kind: "direct",
          directChatId: "chat-1",
          groupId: null,
        },
        createdByUserId: "user-1",
        status: "active",
        activeParticipantCount: 2,
        createdAt: "2026-03-23T10:00:00Z",
        updatedAt: "2026-03-23T10:00:00Z",
        startedAt: "2026-03-23T10:00:00Z",
        endedAt: null,
        endedByUserId: null,
        endReason: "unspecified",
      },
      participants: [
        {
          id: "participant-1",
          callId: "call-1",
          userId: "user-1",
          state: "active",
          joinedAt: "2026-03-23T10:00:00Z",
          leftAt: null,
          updatedAt: "2026-03-23T10:00:00Z",
          lastSignalAt: null,
        },
        {
          id: "participant-2",
          callId: "call-1",
          userId: "user-2",
          state: "active",
          joinedAt: "2026-03-23T10:00:02Z",
          leftAt: null,
          updatedAt: "2026-03-23T10:00:02Z",
          lastSignalAt: null,
        },
      ],
    });
    const joinedState = directCallReducer(readyState, {
      type: "local_joined",
      callId: "call-1",
    });
    const connectedState = directCallReducer(joinedState, {
      type: "peer_state_replaced",
      peerConnectionState: "connected",
    });

    expect(deriveDirectCallUiPhase(connectedState, "user-1")).toBe("connected");
  });
});
