import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  isRTCActiveCallConflict,
  type DirectChat,
  type RtcCallParticipant,
  type RtcSignalEnvelope,
} from "../gateway/types";
import { subscribeRealtimeEnvelopes } from "../realtime/events";
import type { DirectCallAwarenessEntry } from "./awareness";
import { parseRTCRealtimeEvent } from "./realtime";
import {
  decodeRTCIceCandidatePayload,
  decodeRTCSessionDescriptionPayload,
  encodeRTCIceCandidatePayload,
  encodeRTCSessionDescriptionPayload,
} from "./signal";
import {
  createInitialDirectCallState,
  deriveDirectCallUiPhase,
  directCallReducer,
  selectDirectCallRemoteParticipant,
  selectDirectCallSelfParticipant,
} from "./state";
import {
  flushPendingRemoteICECandidates,
  queueOrApplyRemoteICECandidate,
  teardownDirectCallPeerRuntime,
  teardownDirectCallRuntime,
} from "./runtime";

const directCallRefreshIntervalMs = 5000;

interface UseDirectCallSessionOptions {
  enabled: boolean;
  token: string;
  chat: DirectChat | null;
  awarenessEntry: DirectCallAwarenessEntry | null;
  awarenessSyncStatus: "idle" | "loading" | "ready" | "error";
  currentUserId: string;
  pageVisible: boolean;
  refreshDirectChatCall(showLoading?: boolean): Promise<void>;
  onUnauthenticated(): void;
}

export interface DirectCallSession {
  state: ReturnType<typeof createInitialDirectCallState>;
  phase: ReturnType<typeof deriveDirectCallUiPhase>;
  remoteAudioStream: MediaStream | null;
  selfParticipant: RtcCallParticipant | null;
  remoteParticipant: RtcCallParticipant | null;
  canStart: boolean;
  canJoin: boolean;
  canLeave: boolean;
  canEnd: boolean;
  isLocallyJoined: boolean;
  isDirectChatSupported: boolean;
  dismissError(): void;
  retryRemoteAudioPlayback(audioElement: HTMLAudioElement | null): Promise<void>;
  startCall(): Promise<void>;
  joinCall(): Promise<void>;
  leaveCall(): Promise<void>;
  endCall(): Promise<void>;
}

export function useDirectCallSession(
  options: UseDirectCallSessionOptions,
): DirectCallSession {
  const {
    awarenessEntry,
    awarenessSyncStatus,
    chat,
    currentUserId,
    enabled,
    onUnauthenticated,
    pageVisible,
    refreshDirectChatCall,
    token,
  } = options;
  const [state, dispatch] = useReducer(
    directCallReducer,
    undefined,
    createInitialDirectCallState,
  );
  const [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null);
  const stateRef = useRef(state);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingRemoteICECandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const refreshDirectChatCallRef = useRef(refreshDirectChatCall);

  useEffect(() => {
    refreshDirectChatCallRef.current = refreshDirectChatCall;
  }, [refreshDirectChatCall]);

  const runRefreshDirectChatCall = useCallback(
    async (showLoading = false) => {
      await refreshDirectChatCallRef.current(showLoading);
    },
    [],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const isDirectChatSupported =
    chat !== null && isDirectAudioCallSupportedForChatKind(chat.kind);
  const activeChatID = chat?.id ?? null;
  const selfParticipant = selectDirectCallSelfParticipant(state, currentUserId);
  const remoteParticipant = selectDirectCallRemoteParticipant(state, currentUserId);
  const phase = deriveDirectCallUiPhase(state, currentUserId);
  const isLocallyJoined =
    state.call !== null && state.localJoinedCallId === state.call.id;

  const resetPeerRuntime = useCallback(() => {
    if (
      peerConnectionRef.current === null &&
      remoteStreamRef.current === null &&
      stateRef.current.remoteAudioState === "idle" &&
      !stateRef.current.remoteAudioAvailable
    ) {
      return;
    }

    teardownDirectCallPeerRuntime({
      peerConnection: peerConnectionRef.current,
      remoteStream: remoteStreamRef.current,
    });
    peerConnectionRef.current = null;
    remoteStreamRef.current = null;
    pendingRemoteICECandidatesRef.current = [];
    setRemoteAudioStream(null);
    dispatch({
      type: "remote_audio_state_replaced",
      remoteAudioState: "idle",
      remoteAudioAvailable: false,
    });
  }, []);

  const disposeLocalRuntime = useCallback(() => {
    teardownDirectCallRuntime({
      localStream: localStreamRef.current,
      peerConnection: peerConnectionRef.current,
      remoteStream: remoteStreamRef.current,
    });
    localStreamRef.current = null;
    peerConnectionRef.current = null;
    remoteStreamRef.current = null;
    pendingRemoteICECandidatesRef.current = [];
    setRemoteAudioStream(null);
    dispatch({ type: "local_left" });
  }, []);

  const describeError = useCallback((error: unknown, fallbackMessage: string): string => {
    if (isGatewayErrorCode(error, "unauthenticated")) {
      onUnauthenticated();
    }

    return describeGatewayError(error, fallbackMessage);
  }, [onUnauthenticated]);

  const ensureLocalAudioStream = useCallback(async (): Promise<MediaStream> => {
    if (localStreamRef.current !== null) {
      return localStreamRef.current;
    }

    if (
      typeof window === "undefined" ||
      typeof navigator === "undefined" ||
      typeof RTCPeerConnection === "undefined"
    ) {
      const message = "Этот браузер не поддерживает текущий audio-call bootstrap.";
      dispatch({
        type: "media_failed",
        mediaState: "unsupported",
        message,
      });
      throw new Error(message);
    }

    if (!window.isSecureContext) {
      const message =
        "Для доступа к микрофону нужен secure context. Используйте HTTPS или localhost.";
      dispatch({
        type: "media_failed",
        mediaState: "unsupported",
        message,
      });
      throw new Error(message);
    }

    if (navigator.mediaDevices?.getUserMedia === undefined) {
      const message =
        "В этом окружении недоступен `navigator.mediaDevices.getUserMedia({ audio: true })`.";
      dispatch({
        type: "media_failed",
        mediaState: "unsupported",
        message,
      });
      throw new Error(message);
    }

    dispatch({ type: "media_request_started" });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (stream.getAudioTracks().length === 0) {
        teardownDirectCallRuntime({
          localStream: stream,
          peerConnection: null,
          remoteStream: null,
        });
        const message = "Микрофон не дал usable audio track для звонка.";
        dispatch({
          type: "media_failed",
          mediaState: "unavailable",
          message,
        });
        throw new Error(message);
      }

      localStreamRef.current = stream;
      dispatch({ type: "media_ready" });
      return stream;
    } catch (error) {
      const mediaFailure = resolveMediaFailure(error);
      dispatch({
        type: "media_failed",
        mediaState: mediaFailure.mediaState,
        message: mediaFailure.message,
      });
      throw error;
    }
  }, []);

  const sendRTCSignal = useCallback(
    async (
      targetUserId: string,
      signal: {
        type: RtcSignalEnvelope["type"];
        payload: Uint8Array;
      },
    ) => {
      const call = stateRef.current.call;
      if (call === null || stateRef.current.localJoinedCallId !== call.id) {
        return;
      }

      await gatewayClient.sendRtcSignal(token, {
        callId: call.id,
        targetUserId,
        type: signal.type,
        payload: signal.payload,
      });
    },
    [token],
  );

  const ensurePeerConnection = useCallback((): RTCPeerConnection | null => {
    if (peerConnectionRef.current !== null) {
      return peerConnectionRef.current;
    }

    const localStream = localStreamRef.current;
    if (localStream === null) {
      return null;
    }

    const peerConnection = new RTCPeerConnection();
    for (const track of localStream.getTracks()) {
      peerConnection.addTrack(track, localStream);
    }

    peerConnection.addEventListener("icecandidate", (event) => {
      const call = stateRef.current.call;
      const remoteUser = call
        ? selectDirectCallRemoteParticipant(stateRef.current, currentUserId)
        : null;
      if (!event.candidate || call === null || remoteUser === null) {
        return;
      }

      void sendRTCSignal(remoteUser.userId, {
        type: "ice_candidate",
        payload: encodeRTCIceCandidatePayload(event.candidate.toJSON()),
      }).catch((error) => {
        dispatch({
          type: "failure",
          message: describeError(error, "Не удалось отправить ICE candidate."),
        });
      });
    });

    peerConnection.addEventListener("track", (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      remoteStreamRef.current = stream;
      setRemoteAudioStream(stream);
      dispatch({
        type: "remote_audio_state_replaced",
        remoteAudioState: "ready",
        remoteAudioAvailable: true,
      });
    });

    peerConnection.addEventListener("connectionstatechange", () => {
      switch (peerConnection.connectionState) {
        case "connected":
          dispatch({
            type: "peer_state_replaced",
            peerConnectionState: "connected",
          });
          return;
        case "connecting":
          dispatch({
            type: "peer_state_replaced",
            peerConnectionState: "connecting",
          });
          return;
        case "failed":
          dispatch({
            type: "peer_state_replaced",
            peerConnectionState: "failed",
            message: "WebRTC-соединение завершилось с ошибкой.",
          });
          resetPeerRuntime();
          return;
        case "closed":
          dispatch({
            type: "peer_state_replaced",
            peerConnectionState: "idle",
          });
          return;
        default:
      }
    });

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  }, [currentUserId, describeError, resetPeerRuntime, sendRTCSignal]);

  const applyIncomingRTCSignal = useCallback(async (signal: RtcSignalEnvelope) => {
    const currentCall = stateRef.current.call;
    if (
      currentCall === null ||
      currentCall.id !== signal.callId ||
      stateRef.current.localJoinedCallId !== signal.callId
    ) {
      return;
    }

    const peerConnection = ensurePeerConnection();
    if (peerConnection === null) {
      return;
    }

    try {
      switch (signal.type) {
        case "offer": {
          const offer = decodeRTCSessionDescriptionPayload(signal.payload, "offer");
          if (offer === null) {
            throw new Error("invalid offer payload");
          }

          if (peerConnection.signalingState !== "stable") {
            resetPeerRuntime();
            const refreshedPeerConnection = ensurePeerConnection();
            if (refreshedPeerConnection === null) {
              return;
            }
            await refreshedPeerConnection.setRemoteDescription(offer);
            pendingRemoteICECandidatesRef.current = await flushPendingRemoteICECandidates(
              refreshedPeerConnection,
              pendingRemoteICECandidatesRef.current,
            );
            const answer = await refreshedPeerConnection.createAnswer();
            await refreshedPeerConnection.setLocalDescription(answer);
            dispatch({
              type: "peer_state_replaced",
              peerConnectionState: "connecting",
            });
            await sendRTCSignal(signal.fromUserId, {
              type: "answer",
              payload: encodeRTCSessionDescriptionPayload(answer),
            });
            return;
          }

          await peerConnection.setRemoteDescription(offer);
          pendingRemoteICECandidatesRef.current = await flushPendingRemoteICECandidates(
            peerConnection,
            pendingRemoteICECandidatesRef.current,
          );
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          dispatch({
            type: "peer_state_replaced",
            peerConnectionState: "connecting",
          });
          await sendRTCSignal(signal.fromUserId, {
            type: "answer",
            payload: encodeRTCSessionDescriptionPayload(answer),
          });
          return;
        }
        case "answer": {
          const answer = decodeRTCSessionDescriptionPayload(signal.payload, "answer");
          if (answer === null) {
            throw new Error("invalid answer payload");
          }

          await peerConnection.setRemoteDescription(answer);
          pendingRemoteICECandidatesRef.current = await flushPendingRemoteICECandidates(
            peerConnection,
            pendingRemoteICECandidatesRef.current,
          );
          dispatch({
            type: "peer_state_replaced",
            peerConnectionState: "connecting",
          });
          return;
        }
        case "ice_candidate": {
          const candidate = decodeRTCIceCandidatePayload(signal.payload);
          if (candidate === null) {
            throw new Error("invalid ice candidate payload");
          }

          pendingRemoteICECandidatesRef.current = await queueOrApplyRemoteICECandidate(
            peerConnection,
            pendingRemoteICECandidatesRef.current,
            candidate,
          );
          return;
        }
        default:
      }
    } catch (error) {
      dispatch({
        type: "failure",
        message: describeError(error, "Не удалось применить входящий RTC signal."),
      });
    }
  }, [describeError, ensurePeerConnection, resetPeerRuntime, sendRTCSignal]);

  const createOfferForRemoteParticipant = useCallback(async (participant: RtcCallParticipant) => {
    const currentCall = stateRef.current.call;
    if (
      currentCall === null ||
      currentCall.createdByUserId !== currentUserId ||
      stateRef.current.localJoinedCallId !== currentCall.id
    ) {
      return;
    }

    const peerConnection = ensurePeerConnection();
    if (peerConnection === null || peerConnection.signalingState !== "stable") {
      return;
    }
    if (
      peerConnection.connectionState === "connected" ||
      peerConnection.remoteDescription !== null
    ) {
      return;
    }

    try {
      dispatch({
        type: "peer_state_replaced",
        peerConnectionState: "negotiating",
      });
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await sendRTCSignal(participant.userId, {
        type: "offer",
        payload: encodeRTCSessionDescriptionPayload(offer),
      });
      dispatch({
        type: "peer_state_replaced",
        peerConnectionState: "connecting",
      });
    } catch (error) {
      dispatch({
        type: "failure",
        message: describeError(error, "Не удалось создать offer для прямого звонка."),
      });
    }
  }, [currentUserId, describeError, ensurePeerConnection, sendRTCSignal]);

  const bootstrapJoinedCall = useCallback(async (callId: string) => {
    dispatch({ type: "local_joined", callId });
    ensurePeerConnection();
    await runRefreshDirectChatCall(false);
  }, [ensurePeerConnection, runRefreshDirectChatCall]);

  async function startCall() {
    if (!enabled || chat === null || !isDirectChatSupported) {
      return;
    }

    dispatch({ type: "action_started", actionState: "starting" });

    let localStream: MediaStream | null = null;
    try {
      localStream = await ensureLocalAudioStream();
      const response = await gatewayClient.startCall(token, {
        kind: "direct",
        directChatId: chat.id,
      });
      dispatch({ type: "action_finished" });
      localStreamRef.current = localStream;
      await bootstrapJoinedCall(response.call.id);
    } catch (error) {
      if (localStream !== null) {
        teardownDirectCallRuntime({
          localStream: localStreamRef.current ?? localStream,
          peerConnection: peerConnectionRef.current,
          remoteStream: remoteStreamRef.current,
        });
        localStreamRef.current = null;
        peerConnectionRef.current = null;
        remoteStreamRef.current = null;
        setRemoteAudioStream(null);
        dispatch({ type: "local_left" });
      }

      dispatch({ type: "action_finished" });
      if (isRTCActiveCallConflict(error)) {
        dispatch({
          type: "failure",
          message: "Нельзя начать новый звонок, пока вы уже участвуете в другом активном звонке.",
        });
        return;
      }
      if (isGatewayErrorCode(error, "failed_precondition")) {
        await runRefreshDirectChatCall(false);
        dispatch({
          type: "failure",
          message:
            "Для этого direct chat уже существует активный звонок. Можно присоединиться к нему.",
        });
        return;
      }

      dispatch({
        type: "failure",
        message: describeError(error, "Не удалось начать аудиозвонок."),
      });
    }
  }

  async function joinCall() {
    const currentCall = stateRef.current.call;
    if (
      !enabled ||
      chat === null ||
      currentCall === null ||
      !isDirectChatSupported
    ) {
      return;
    }

    dispatch({ type: "action_started", actionState: "joining" });

    let localStream: MediaStream | null = null;
    try {
      localStream = await ensureLocalAudioStream();
      const response = await gatewayClient.joinCall(token, currentCall.id);
      dispatch({ type: "action_finished" });
      localStreamRef.current = localStream;
      await bootstrapJoinedCall(response.call.id);
    } catch (error) {
      if (localStream !== null) {
        teardownDirectCallRuntime({
          localStream: localStreamRef.current ?? localStream,
          peerConnection: peerConnectionRef.current,
          remoteStream: remoteStreamRef.current,
        });
        localStreamRef.current = null;
        peerConnectionRef.current = null;
        remoteStreamRef.current = null;
        setRemoteAudioStream(null);
        dispatch({ type: "local_left" });
      }

      dispatch({ type: "action_finished" });
      if (isRTCActiveCallConflict(error)) {
        dispatch({
          type: "failure",
          message:
            "Нельзя присоединиться к этому звонку, пока вы уже участвуете в другом активном звонке.",
        });
        return;
      }
      dispatch({
        type: "failure",
        message: describeError(error, "Не удалось присоединиться к активному звонку."),
      });
    }
  }

  async function leaveCall() {
    const currentCall = stateRef.current.call;
    if (currentCall === null) {
      disposeLocalRuntime();
      return;
    }

    dispatch({ type: "action_started", actionState: "leaving" });

    try {
      await gatewayClient.leaveCall(token, currentCall.id);
    } catch (error) {
      dispatch({
        type: "failure",
        message: describeError(error, "Не удалось покинуть звонок."),
      });
    } finally {
      dispatch({ type: "action_finished" });
      disposeLocalRuntime();
      await runRefreshDirectChatCall(false);
    }
  }

  async function endCall() {
    const currentCall = stateRef.current.call;
    if (currentCall === null) {
      disposeLocalRuntime();
      return;
    }

    dispatch({ type: "action_started", actionState: "ending" });

    try {
      await gatewayClient.endCall(token, currentCall.id);
    } catch (error) {
      dispatch({
        type: "failure",
        message: describeError(error, "Не удалось завершить звонок."),
      });
    } finally {
      dispatch({ type: "action_finished" });
      disposeLocalRuntime();
      await runRefreshDirectChatCall(false);
    }
  }

  function dismissError() {
    dispatch({ type: "clear_error" });
  }

  async function retryRemoteAudioPlayback(audioElement: HTMLAudioElement | null) {
    if (audioElement === null) {
      return;
    }

    try {
      await audioElement.play();
      dispatch({
        type: "remote_audio_state_replaced",
        remoteAudioState: stateRef.current.remoteAudioAvailable ? "ready" : "idle",
        remoteAudioAvailable: stateRef.current.remoteAudioAvailable,
      });
    } catch {
      dispatch({
        type: "remote_audio_state_replaced",
        remoteAudioState: "blocked",
        remoteAudioAvailable: stateRef.current.remoteAudioAvailable,
      });
    }
  }

  useEffect(() => {
    if (!enabled || activeChatID === null || !isDirectChatSupported) {
      dispatch({ type: "sync_succeeded", call: null, participants: [] });
      return;
    }

    dispatch({ type: "sync_started" });
    void runRefreshDirectChatCall(true);

    return () => {
      disposeLocalRuntime();
    };
  }, [
    activeChatID,
    disposeLocalRuntime,
    enabled,
    isDirectChatSupported,
    runRefreshDirectChatCall,
  ]);

  useEffect(() => {
    if (!enabled || activeChatID === null || !isDirectChatSupported) {
      return;
    }

    if (awarenessEntry === null) {
      if (awarenessSyncStatus === "loading") {
        dispatch({ type: "sync_started" });
        return;
      }

      dispatch({
        type: "sync_succeeded",
        call: null,
        participants: [],
      });
      return;
    }

    if (awarenessEntry.syncStatus === "error") {
      dispatch({
        type: "sync_failed",
        message:
          awarenessEntry.errorMessage ??
          "Не удалось синхронизировать состояние звонка.",
      });
      return;
    }

    dispatch({
      type: "sync_succeeded",
      call: awarenessEntry.call,
      participants: awarenessEntry.participants,
    });
  }, [activeChatID, awarenessEntry, awarenessSyncStatus, enabled, isDirectChatSupported]);

  useEffect(() => {
    if (!enabled || activeChatID === null || !isDirectChatSupported) {
      return;
    }

    return subscribeRealtimeEnvelopes((envelope) => {
      const event = parseRTCRealtimeEvent(envelope);
      if (event === null) {
        return;
      }

      if (event.type === "rtc.signal.received") {
        void applyIncomingRTCSignal(event.signal);
      }
    });
  }, [activeChatID, applyIncomingRTCSignal, enabled, isDirectChatSupported]);

  useEffect(() => {
    if (
      !enabled ||
      !pageVisible ||
      activeChatID === null ||
      !isDirectChatSupported ||
      (state.call === null && state.localJoinedCallId === null)
    ) {
      return;
    }

    const intervalID = window.setInterval(() => {
      void runRefreshDirectChatCall(false);
    }, directCallRefreshIntervalMs);

    return () => {
      window.clearInterval(intervalID);
    };
  }, [
    activeChatID,
    isDirectChatSupported,
    enabled,
    pageVisible,
    token,
    runRefreshDirectChatCall,
    state.call,
    state.localJoinedCallId,
  ]);

  useEffect(() => {
    if (state.call !== null || state.localJoinedCallId !== null) {
      return;
    }

    if (localStreamRef.current === null) {
      return;
    }

    disposeLocalRuntime();
  }, [disposeLocalRuntime, state.call, state.localJoinedCallId]);

  useEffect(() => {
    const joinedCall = state.call;
    if (joinedCall === null || state.localJoinedCallId !== joinedCall.id) {
      resetPeerRuntime();
      return;
    }

    const nextSelfParticipant = selectDirectCallSelfParticipant(state, currentUserId);
    const nextRemoteParticipant = selectDirectCallRemoteParticipant(state, currentUserId);

    if (nextSelfParticipant === null) {
      disposeLocalRuntime();
      return;
    }

    if (nextRemoteParticipant === null) {
      resetPeerRuntime();
      if (state.peerConnectionState !== "waiting_for_peer") {
        dispatch({
          type: "peer_state_replaced",
          peerConnectionState: "waiting_for_peer",
        });
      }
      return;
    }

    ensurePeerConnection();
    if (joinedCall.createdByUserId === currentUserId) {
      void createOfferForRemoteParticipant(nextRemoteParticipant);
    } else if (
      peerConnectionRef.current?.connectionState !== "connected" &&
      state.peerConnectionState !== "connecting"
    ) {
      dispatch({
        type: "peer_state_replaced",
        peerConnectionState: "connecting",
      });
    }
  }, [
    createOfferForRemoteParticipant,
    disposeLocalRuntime,
    ensurePeerConnection,
    currentUserId,
    resetPeerRuntime,
    state,
  ]);

  return {
    state,
    phase,
    remoteAudioStream,
    selfParticipant,
    remoteParticipant,
    canStart:
      isDirectChatSupported &&
      state.call === null &&
      state.actionState === "idle" &&
      enabled,
    canJoin:
      isDirectChatSupported &&
      state.call !== null &&
      state.localJoinedCallId === null &&
      state.actionState === "idle" &&
      enabled,
    canLeave:
      isDirectChatSupported &&
      state.call !== null &&
      state.localJoinedCallId === state.call.id &&
      state.actionState === "idle",
    canEnd:
      isDirectChatSupported &&
      state.call !== null &&
      state.call.createdByUserId === currentUserId &&
      state.actionState === "idle",
    isLocallyJoined,
    isDirectChatSupported,
    dismissError,
    retryRemoteAudioPlayback,
    startCall,
    joinCall,
    leaveCall,
    endCall,
  };
}

export function isDirectAudioCallSupportedForChatKind(kind: string): boolean {
  return kind === "CHAT_KIND_DIRECT" || kind === "direct";
}

function resolveMediaFailure(error: unknown): {
  mediaState: "unsupported" | "denied" | "unavailable" | "error";
  message: string;
} {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "SecurityError":
        return {
          mediaState: "denied",
          message:
            "Браузер не дал доступ к микрофону. Разрешите audio capture и попробуйте снова.",
        };
      case "NotFoundError":
      case "DevicesNotFoundError":
        return {
          mediaState: "unavailable",
          message: "Микрофон не найден. Подключите устройство ввода и повторите попытку.",
        };
      case "NotReadableError":
      case "AbortError":
      case "TrackStartError":
        return {
          mediaState: "unavailable",
          message: "Не удалось захватить микрофон в текущем браузерном окружении.",
        };
      case "TypeError":
        return {
          mediaState: "unsupported",
          message: "Этот браузер не поддерживает audio capture для текущего call bootstrap.",
        };
      default:
    }
  }

  return {
    mediaState: "error",
    message: "Не удалось подготовить микрофон для прямого звонка.",
  };
}
