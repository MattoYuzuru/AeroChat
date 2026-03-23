import type { RtcCall, RtcCallParticipant } from "../gateway/types";

export type DirectCallSyncStatus = "idle" | "loading" | "ready" | "error";
export type DirectCallActionState =
  | "idle"
  | "starting"
  | "joining"
  | "leaving"
  | "ending";
export type DirectCallMediaState =
  | "idle"
  | "requesting"
  | "ready"
  | "unsupported"
  | "denied"
  | "unavailable"
  | "error";
export type DirectCallPeerConnectionState =
  | "idle"
  | "waiting_for_peer"
  | "negotiating"
  | "connecting"
  | "connected"
  | "failed";
export type DirectCallRemoteAudioState = "idle" | "ready" | "blocked";
export type DirectCallTerminalState = "idle" | "ended" | "failed";
export type DirectCallUiPhase =
  | "idle"
  | "starting"
  | "ringing"
  | "connecting"
  | "connected"
  | "ending"
  | "ended"
  | "failed";

export interface DirectCallState {
  syncStatus: DirectCallSyncStatus;
  call: RtcCall | null;
  participants: RtcCallParticipant[];
  localJoinedCallId: string | null;
  actionState: DirectCallActionState;
  mediaState: DirectCallMediaState;
  peerConnectionState: DirectCallPeerConnectionState;
  remoteAudioState: DirectCallRemoteAudioState;
  remoteAudioAvailable: boolean;
  terminalState: DirectCallTerminalState;
  errorMessage: string | null;
}

export type DirectCallAction =
  | { type: "sync_started" }
  | {
      type: "sync_succeeded";
      call: RtcCall | null;
      participants: RtcCallParticipant[];
    }
  | { type: "sync_failed"; message: string }
  | { type: "action_started"; actionState: Exclude<DirectCallActionState, "idle"> }
  | { type: "action_finished" }
  | { type: "local_joined"; callId: string }
  | { type: "local_left" }
  | { type: "media_request_started" }
  | { type: "media_ready" }
  | {
      type: "media_failed";
      mediaState: Exclude<DirectCallMediaState, "idle" | "requesting" | "ready">;
      message: string;
    }
  | {
      type: "peer_state_replaced";
      peerConnectionState: DirectCallPeerConnectionState;
      message?: string | null;
    }
  | {
      type: "remote_audio_state_replaced";
      remoteAudioState: DirectCallRemoteAudioState;
      remoteAudioAvailable: boolean;
    }
  | { type: "failure"; message: string }
  | { type: "clear_error" };

export function createInitialDirectCallState(): DirectCallState {
  return {
    syncStatus: "idle",
    call: null,
    participants: [],
    localJoinedCallId: null,
    actionState: "idle",
    mediaState: "idle",
    peerConnectionState: "idle",
    remoteAudioState: "idle",
    remoteAudioAvailable: false,
    terminalState: "idle",
    errorMessage: null,
  };
}

export function directCallReducer(
  state: DirectCallState,
  action: DirectCallAction,
): DirectCallState {
  switch (action.type) {
    case "sync_started":
      return {
        ...state,
        syncStatus: "loading",
        errorMessage: null,
      };
    case "sync_succeeded": {
      const hasEnded =
        state.call !== null &&
        action.call === null &&
        state.actionState === "idle" &&
        state.errorMessage === null;
      const localCallStillJoined =
        action.call !== null && state.localJoinedCallId === action.call.id
          ? state.localJoinedCallId
          : null;

      return {
        ...state,
        syncStatus: "ready",
        call: action.call,
        participants: action.participants,
        localJoinedCallId: localCallStillJoined,
        terminalState: hasEnded ? "ended" : state.terminalState,
        errorMessage: null,
      };
    }
    case "sync_failed":
      return {
        ...state,
        syncStatus: "error",
        terminalState: "failed",
        errorMessage: action.message,
      };
    case "action_started":
      return {
        ...state,
        actionState: action.actionState,
        terminalState: "idle",
        errorMessage: null,
      };
    case "action_finished":
      return {
        ...state,
        actionState: "idle",
      };
    case "local_joined":
      return {
        ...state,
        localJoinedCallId: action.callId,
        terminalState: "idle",
        errorMessage: null,
      };
    case "local_left":
      return {
        ...state,
        localJoinedCallId: null,
        mediaState: "idle",
        peerConnectionState: "idle",
        remoteAudioState: "idle",
        remoteAudioAvailable: false,
      };
    case "media_request_started":
      return {
        ...state,
        mediaState: "requesting",
        terminalState: "idle",
        errorMessage: null,
      };
    case "media_ready":
      return {
        ...state,
        mediaState: "ready",
      };
    case "media_failed":
      return {
        ...state,
        mediaState: action.mediaState,
        terminalState: "failed",
        errorMessage: action.message,
      };
    case "peer_state_replaced":
      return {
        ...state,
        peerConnectionState: action.peerConnectionState,
        terminalState:
          action.peerConnectionState === "failed" ? "failed" : state.terminalState,
        errorMessage: action.message ?? state.errorMessage,
      };
    case "remote_audio_state_replaced":
      return {
        ...state,
        remoteAudioState: action.remoteAudioState,
        remoteAudioAvailable: action.remoteAudioAvailable,
      };
    case "failure":
      return {
        ...state,
        actionState: "idle",
        terminalState: "failed",
        errorMessage: action.message,
      };
    case "clear_error":
      return {
        ...state,
        errorMessage: null,
        terminalState: state.terminalState === "failed" ? "idle" : state.terminalState,
      };
    default:
      return state;
  }
}

export function selectDirectCallSelfParticipant(
  state: DirectCallState,
  currentUserId: string,
): RtcCallParticipant | null {
  return (
    state.participants.find(
      (participant) =>
        participant.userId === currentUserId && participant.state === "active",
    ) ?? null
  );
}

export function selectDirectCallRemoteParticipant(
  state: DirectCallState,
  currentUserId: string,
): RtcCallParticipant | null {
  return (
    state.participants.find(
      (participant) =>
        participant.userId !== currentUserId && participant.state === "active",
    ) ?? null
  );
}

export function deriveDirectCallUiPhase(
  state: DirectCallState,
  currentUserId: string,
): DirectCallUiPhase {
  if (state.actionState === "starting" || state.actionState === "joining") {
    return "starting";
  }

  if (state.actionState === "leaving" || state.actionState === "ending") {
    return "ending";
  }

  if (state.terminalState === "failed") {
    return "failed";
  }

  if (state.terminalState === "ended") {
    return "ended";
  }

  if (state.peerConnectionState === "connected") {
    return "connected";
  }

  if (
    state.peerConnectionState === "connecting" ||
    state.peerConnectionState === "negotiating"
  ) {
    return "connecting";
  }

  const call = state.call;
  if (!call || call.status !== "active") {
    return "idle";
  }

  const selfParticipant = selectDirectCallSelfParticipant(state, currentUserId);
  const remoteParticipant = selectDirectCallRemoteParticipant(state, currentUserId);
  if (selfParticipant && remoteParticipant) {
    return "connecting";
  }

  return "ringing";
}
