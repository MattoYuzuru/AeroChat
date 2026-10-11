import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { resolveGatewayBaseUrl } from "../gateway/client";
import { gatewayClient } from "../gateway/runtime";
import {
  describeGatewayError,
  isGatewayErrorCode,
  isRTCActiveCallConflict,
  type DirectChat,
  type RtcCall,
  type RtcCallParticipant,
  type RtcSignalEnvelope,
} from "../gateway/types";
import {
  subscribeRealtimeEnvelopes,
  subscribeRealtimeLifecycleEvents,
} from "../realtime/events";
import type { DirectCallAwarenessEntry } from "./awareness";
import type { DirectCallJoinCoordinator, DirectCallJoinLease } from "./join-coordinator";
import {
  applyDirectCallTrackContentHint,
  buildDirectCallAudioConstraints,
  tuneDirectCallSenderForVoice,
} from "./audio";
import { sendRtcLeaveCallKeepalive } from "./network";
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
  buildNextPeerRecoveryPlan,
  flushPendingRemoteICECandidates,
  hasMatchingRemoteSessionDescription,
  queueOrApplyRemoteICECandidate,
  shouldRecoverPeerConnectionAfterDisconnect,
  shouldDelayPeerRuntimeRecovery,
  teardownDirectCallPeerRuntime,
  teardownDirectCallRuntime,
} from "./runtime";
import {
  buildDirectCallRTCConfiguration,
  directCallRTCConfiguration,
} from "./config";

const directCallGatewayBaseUrl = resolveGatewayBaseUrl();
const directCallParticipantHeartbeatIntervalMs = 20_000;
const directCallDisconnectRecoveryGraceMs = 8_000;

interface UseDirectCallSessionOptions {
  joinCoordinator: DirectCallJoinCoordinator;
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
    joinCoordinator,
    onUnauthenticated,
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
  const localJoinedCallIdRef = useRef<string | null>(null);
  const runtimeGenerationRef = useRef(0);
  const pendingJoinGenerationRef = useRef<number | null>(null);
  const sessionActiveRef = useRef(false);
  const peerRecoveryHandlerRef = useRef<(reason: "disconnected" | "failed") => boolean>(
    () => false,
  );
  const peerRecoveryPlanRef = useRef<{
    attempts: number;
    blockedUntilMs: number;
    callId: string;
    remoteUserId: string;
  } | null>(null);
  const peerRecoveryTimerRef = useRef<number | null>(null);
  const disconnectRecoveryTimerRef = useRef<number | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingRemoteICECandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const rtcConfigurationRef = useRef<RTCConfiguration>(directCallRTCConfiguration);
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  const refreshDirectChatCallRef = useRef(refreshDirectChatCall);

  useEffect(() => {
    onUnauthenticatedRef.current = onUnauthenticated;
  }, [onUnauthenticated]);

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
  const joinedCallID = state.call?.id ?? null;
  const selfParticipant = selectDirectCallSelfParticipant(state, currentUserId);
  const remoteParticipant = selectDirectCallRemoteParticipant(state, currentUserId);
  const phase = deriveDirectCallUiPhase(state, currentUserId);
  const isLocallyJoined =
    state.call !== null && state.localJoinedCallId === state.call.id;

  const clearPeerRecoveryTimer = useCallback(() => {
    if (peerRecoveryTimerRef.current === null) {
      return;
    }

    window.clearTimeout(peerRecoveryTimerRef.current);
    peerRecoveryTimerRef.current = null;
  }, []);

  const clearDisconnectRecoveryTimer = useCallback(() => {
    if (disconnectRecoveryTimerRef.current === null) {
      return;
    }

    window.clearTimeout(disconnectRecoveryTimerRef.current);
    disconnectRecoveryTimerRef.current = null;
  }, []);

  const clearPeerRecoveryPlan = useCallback(() => {
    clearPeerRecoveryTimer();
    peerRecoveryPlanRef.current = null;
  }, [clearPeerRecoveryTimer]);

  const refreshRTCConfiguration = useCallback(async (generation = runtimeGenerationRef.current) => {
    try {
      const iceServers = await gatewayClient.getRtcIceServers(token);
      if (runtimeGenerationRef.current === generation) {
        rtcConfigurationRef.current = buildDirectCallRTCConfiguration(iceServers);
      }
    } catch {
      if (runtimeGenerationRef.current === generation) {
        rtcConfigurationRef.current = directCallRTCConfiguration;
      }
    }
  }, [token]);

  const resetPeerRuntime = useCallback(() => {
    if (
      peerConnectionRef.current === null &&
      remoteStreamRef.current === null &&
      stateRef.current.remoteAudioState === "idle" &&
      !stateRef.current.remoteAudioAvailable
    ) {
      return;
    }

    clearDisconnectRecoveryTimer();
    const peerConnection = peerConnectionRef.current;
    const remoteStream = remoteStreamRef.current;
    peerConnectionRef.current = null;
    remoteStreamRef.current = null;
    teardownDirectCallPeerRuntime({
      peerConnection,
      remoteStream,
    });
    pendingRemoteICECandidatesRef.current = [];
    setRemoteAudioStream(null);
    dispatch({
      type: "remote_audio_state_replaced",
      remoteAudioState: "idle",
      remoteAudioAvailable: false,
    });
  }, [clearDisconnectRecoveryTimer]);

  const disposeLocalRuntime = useCallback(() => {
    runtimeGenerationRef.current += 1;
    if (pendingJoinGenerationRef.current !== null) {
      pendingJoinGenerationRef.current = null;
      dispatch({ type: "action_finished" });
    }
    clearPeerRecoveryPlan();
    clearDisconnectRecoveryTimer();
    teardownDirectCallRuntime({
      localStream: localStreamRef.current,
      peerConnection: peerConnectionRef.current,
      remoteStream: remoteStreamRef.current,
    });
    localStreamRef.current = null;
    localJoinedCallIdRef.current = null;
    peerConnectionRef.current = null;
    remoteStreamRef.current = null;
    pendingRemoteICECandidatesRef.current = [];
    setRemoteAudioStream(null);
    dispatch({ type: "local_left" });
  }, [clearDisconnectRecoveryTimer, clearPeerRecoveryPlan]);

  const scheduleDisconnectedPeerRecovery = useCallback(
    (peerConnection: RTCPeerConnection) => {
      if (typeof window === "undefined" || disconnectRecoveryTimerRef.current !== null) {
        return;
      }

      disconnectRecoveryTimerRef.current = window.setTimeout(() => {
        disconnectRecoveryTimerRef.current = null;

        if (peerConnectionRef.current !== peerConnection) {
          return;
        }

        if (!shouldRecoverPeerConnectionAfterDisconnect(peerConnection)) {
          return;
        }

        if (peerRecoveryHandlerRef.current("disconnected")) {
          dispatch({
            type: "peer_state_replaced",
            peerConnectionState: "connecting",
          });
        }
      }, directCallDisconnectRecoveryGraceMs);
    },
    [],
  );

  const describeError = useCallback((error: unknown, fallbackMessage: string): string => {
    if (isGatewayErrorCode(error, "unauthenticated")) {
      onUnauthenticated();
    }

    return describeGatewayError(error, fallbackMessage);
  }, [onUnauthenticated]);

  const ensureLocalAudioStream = useCallback(async (generation: number): Promise<MediaStream> => {
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildDirectCallAudioConstraints(
          navigator.mediaDevices.getSupportedConstraints?.() ?? {},
        ),
      });
      if (runtimeGenerationRef.current !== generation) {
        teardownDirectCallRuntime({ localStream: stream, peerConnection: null, remoteStream: null });
        throw new Error("Запуск звонка отменён после смены локальной сессии.");
      }
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

      stream.getAudioTracks().forEach((track) => {
        applyDirectCallTrackContentHint(track);
      });
      localStreamRef.current = stream;
      dispatch({ type: "media_ready" });
      return stream;
    } catch (error) {
      if (runtimeGenerationRef.current !== generation) {
        throw error;
      }
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
      if (call === null || localJoinedCallIdRef.current !== call.id) {
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

    const peerConnection = new RTCPeerConnection(rtcConfigurationRef.current);
    for (const track of localStream.getTracks()) {
      applyDirectCallTrackContentHint(track);
      const sender = peerConnection.addTrack(track, localStream);
      void tuneDirectCallSenderForVoice(sender);
    }

    peerConnection.addEventListener("icecandidate", (event) => {
      if (peerConnectionRef.current !== peerConnection) return;
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
        if (peerConnectionRef.current !== peerConnection) return;
        dispatch({
          type: "failure",
          message: describeError(error, "Не удалось отправить ICE candidate."),
        });
      });
    });

    peerConnection.addEventListener("track", (event) => {
      if (peerConnectionRef.current !== peerConnection) return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      remoteStreamRef.current = stream;
      setRemoteAudioStream(stream);
      dispatch({
        type: "remote_audio_state_replaced",
        remoteAudioState: "ready",
        remoteAudioAvailable: true,
      });
    });

    peerConnection.addEventListener("iceconnectionstatechange", () => {
      if (peerConnectionRef.current !== peerConnection) return;
      switch (peerConnection.iceConnectionState) {
        case "connected":
        case "completed":
          clearDisconnectRecoveryTimer();
          clearPeerRecoveryPlan();
          return;
        default:
      }
    });

    peerConnection.addEventListener("connectionstatechange", () => {
      if (peerConnectionRef.current !== peerConnection) return;
      switch (peerConnection.connectionState) {
        case "connected":
          clearDisconnectRecoveryTimer();
          clearPeerRecoveryPlan();
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
        case "disconnected":
          scheduleDisconnectedPeerRecovery(peerConnection);
          dispatch({
            type: "peer_state_replaced",
            peerConnectionState: "connecting",
          });
          return;
        case "failed":
          clearDisconnectRecoveryTimer();
          if (peerRecoveryHandlerRef.current("failed")) {
            dispatch({
              type: "peer_state_replaced",
              peerConnectionState: "connecting",
            });
            return;
          }
          dispatch({
            type: "peer_state_replaced",
            peerConnectionState: "failed",
            message: "WebRTC-соединение завершилось с ошибкой.",
          });
          disposeLocalRuntime();
          return;
        case "closed":
          clearDisconnectRecoveryTimer();
          clearPeerRecoveryPlan();
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
  }, [
    clearDisconnectRecoveryTimer,
    clearPeerRecoveryPlan,
    currentUserId,
    describeError,
    disposeLocalRuntime,
    resetPeerRuntime,
    scheduleDisconnectedPeerRecovery,
    sendRTCSignal,
  ]);

  const applyIncomingRTCSignal = useCallback(async (signal: RtcSignalEnvelope) => {
    const currentCall = stateRef.current.call;
    if (
      currentCall === null ||
      currentCall.id !== signal.callId ||
      localJoinedCallIdRef.current !== signal.callId
    ) {
      return;
    }

    const peerConnection = ensurePeerConnection();
    if (peerConnection === null) {
      return;
    }

    const generation = runtimeGenerationRef.current;
    let applyingPeer = peerConnection;
    const isCurrentPeer = () =>
      runtimeGenerationRef.current === generation && peerConnectionRef.current === applyingPeer;

    try {
      switch (signal.type) {
        case "offer": {
          const offer = decodeRTCSessionDescriptionPayload(signal.payload, "offer");
          if (offer === null) {
            throw new Error("invalid offer payload");
          }

          if (hasMatchingRemoteSessionDescription(peerConnection, offer)) {
            return;
          }

          if (peerConnection.signalingState !== "stable") {
            resetPeerRuntime();
            const refreshedPeerConnection = ensurePeerConnection();
            if (refreshedPeerConnection === null) {
              return;
            }
            applyingPeer = refreshedPeerConnection;
            if (hasMatchingRemoteSessionDescription(refreshedPeerConnection, offer)) {
              return;
            }
            await refreshedPeerConnection.setRemoteDescription(offer);
            if (!isCurrentPeer()) return;
            const pendingCandidates = await flushPendingRemoteICECandidates(
              refreshedPeerConnection,
              pendingRemoteICECandidatesRef.current,
            );
            if (!isCurrentPeer()) return;
            pendingRemoteICECandidatesRef.current = pendingCandidates;
            const answer = await refreshedPeerConnection.createAnswer();
            if (!isCurrentPeer()) return;
            await refreshedPeerConnection.setLocalDescription(answer);
            if (!isCurrentPeer()) return;
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
          if (!isCurrentPeer()) return;
          const pendingCandidates = await flushPendingRemoteICECandidates(
            peerConnection,
            pendingRemoteICECandidatesRef.current,
          );
          if (!isCurrentPeer()) return;
          pendingRemoteICECandidatesRef.current = pendingCandidates;
          const answer = await peerConnection.createAnswer();
          if (!isCurrentPeer()) return;
          await peerConnection.setLocalDescription(answer);
          if (!isCurrentPeer()) return;
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

          if (hasMatchingRemoteSessionDescription(peerConnection, answer)) {
            return;
          }

          await peerConnection.setRemoteDescription(answer);
          if (!isCurrentPeer()) return;
          const pendingCandidates = await flushPendingRemoteICECandidates(
            peerConnection,
            pendingRemoteICECandidatesRef.current,
          );
          if (!isCurrentPeer()) return;
          pendingRemoteICECandidatesRef.current = pendingCandidates;
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

          const pendingCandidates = await queueOrApplyRemoteICECandidate(
            peerConnection,
            pendingRemoteICECandidatesRef.current,
            candidate,
          );
          if (!isCurrentPeer()) return;
          pendingRemoteICECandidatesRef.current = pendingCandidates;
          return;
        }
        default:
      }
    } catch (error) {
      if (!isCurrentPeer()) return;
      dispatch({
        type: "failure",
        message: describeError(error, "Не удалось применить входящий RTC signal."),
      });
    }
  }, [
    describeError,
    ensurePeerConnection,
    resetPeerRuntime,
    sendRTCSignal,
  ]);

  const createOfferForRemoteParticipant = useCallback(async (participant: RtcCallParticipant) => {
    const currentCall = stateRef.current.call;
    if (
      currentCall === null ||
      currentCall.createdByUserId !== currentUserId ||
      localJoinedCallIdRef.current !== currentCall.id
    ) {
      return;
    }

    if (
      shouldDelayPeerRuntimeRecovery(
        peerRecoveryPlanRef.current,
        currentCall.id,
        participant.userId,
        Date.now(),
      )
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

    const generation = runtimeGenerationRef.current;
    const isCurrentPeer = () =>
      runtimeGenerationRef.current === generation && peerConnectionRef.current === peerConnection;

    try {
      dispatch({
        type: "peer_state_replaced",
        peerConnectionState: "negotiating",
      });
      const offer = await peerConnection.createOffer();
      if (!isCurrentPeer()) return;
      await peerConnection.setLocalDescription(offer);
      if (!isCurrentPeer()) return;
      await sendRTCSignal(participant.userId, {
        type: "offer",
        payload: encodeRTCSessionDescriptionPayload(offer),
      });
      if (!isCurrentPeer()) return;
      dispatch({
        type: "peer_state_replaced",
        peerConnectionState: "connecting",
      });
    } catch (error) {
      if (!isCurrentPeer()) return;
      dispatch({
        type: "failure",
        message: describeError(error, "Не удалось создать offer для прямого звонка."),
      });
    }
  }, [currentUserId, describeError, ensurePeerConnection, sendRTCSignal]);

  const schedulePeerRecovery = useCallback((reason: "disconnected" | "failed"): boolean => {
    const currentCall = stateRef.current.call;
    const remoteParticipant =
      currentCall === null
        ? null
        : selectDirectCallRemoteParticipant(stateRef.current, currentUserId);
    if (
      currentCall === null ||
      remoteParticipant === null ||
      localJoinedCallIdRef.current !== currentCall.id
    ) {
      return false;
    }

    const nextPlan = buildNextPeerRecoveryPlan(
      peerRecoveryPlanRef.current,
      currentCall.id,
      remoteParticipant.userId,
      Date.now(),
      reason === "failed"
        ? {
            baseDelayMs: 750,
            maxDelayMs: 4000,
            maxAttempts: 4,
          }
        : {
            baseDelayMs: 1500,
            maxDelayMs: 5000,
            maxAttempts: 4,
          },
    );
    if (nextPlan === null) {
      return false;
    }

    clearPeerRecoveryTimer();
    peerRecoveryPlanRef.current = nextPlan;
    const generation = runtimeGenerationRef.current;
    peerRecoveryTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const plan = peerRecoveryPlanRef.current;
        if (
          plan === null ||
          plan.callId !== currentCall.id ||
          plan.remoteUserId !== remoteParticipant.userId
        ) {
          return;
        }

        await refreshRTCConfiguration(generation);
        if (runtimeGenerationRef.current !== generation || peerRecoveryPlanRef.current !== plan) {
          return;
        }
        resetPeerRuntime();

        const refreshedCall = stateRef.current.call;
        const refreshedRemoteParticipant =
          refreshedCall === null
            ? null
            : selectDirectCallRemoteParticipant(stateRef.current, currentUserId);
        if (
          refreshedCall === null ||
          refreshedRemoteParticipant === null ||
          localJoinedCallIdRef.current !== refreshedCall.id
        ) {
          return;
        }

        ensurePeerConnection();
        if (refreshedCall.createdByUserId === currentUserId) {
          await createOfferForRemoteParticipant(refreshedRemoteParticipant);
          return;
        }

        dispatch({
          type: "peer_state_replaced",
          peerConnectionState: "connecting",
        });
      })().catch(() => {
        // Любая ошибка следующего recovery attempt всё равно проявится через очередной failure/disconnect event.
      });
    }, Math.max(0, nextPlan.blockedUntilMs - Date.now()));

    return true;
  }, [
    clearPeerRecoveryTimer,
    createOfferForRemoteParticipant,
    currentUserId,
    ensurePeerConnection,
    refreshRTCConfiguration,
    resetPeerRuntime,
  ]);

  const bootstrapJoinedCall = useCallback(async (
    call: RtcCall,
    selfParticipant: RtcCallParticipant | null,
  ) => {
    clearPeerRecoveryPlan();
    localJoinedCallIdRef.current = call.id;
    dispatch({
      type: "local_call_bootstrapped",
      call,
      selfParticipant,
    });
    ensurePeerConnection();
    await runRefreshDirectChatCall(false);
  }, [clearPeerRecoveryPlan, ensurePeerConnection, runRefreshDirectChatCall]);

  // Выход из звонка должен мгновенно освобождать local media/runtime:
  // ожидание server round-trip на плохой сети подвешивает страницу и ломает UX.
  const queueRtcExitMutation = useCallback((
    callId: string,
    performExit: () => Promise<unknown>,
    fallbackToLeaveKeepalive: boolean,
  ) => {
    void performExit().catch((error) => {
      if (isGatewayErrorCode(error, "unauthenticated")) {
        onUnauthenticatedRef.current();
        return;
      }

      if (fallbackToLeaveKeepalive) {
        sendRtcLeaveCallKeepalive(token, callId, directCallGatewayBaseUrl);
      }
    }).finally(() => {
      void runRefreshDirectChatCall(false);
    });
  }, [runRefreshDirectChatCall, token]);

  useEffect(() => {
    peerRecoveryHandlerRef.current = schedulePeerRecovery;

    return () => {
      peerRecoveryHandlerRef.current = () => false;
    };
  }, [schedulePeerRecovery]);

  async function compensateCancelledJoin(callId: string, chatId: string, lease: DirectCallJoinLease) {
    try {
      await gatewayClient.leaveCall(token, callId);
    } catch {
      lease.markUncertain(chatId, callId);
    }
  }

  async function startCall() {
    if (!sessionActiveRef.current || !enabled || chat === null || !isDirectChatSupported || pendingJoinGenerationRef.current !== null) {
      return;
    }

    const acquisition = joinCoordinator.acquire(currentUserId, null);
    if (acquisition.lease === null) {
      dispatch({ type: "failure", message: acquisition.message });
      void runRefreshDirectChatCall(false);
      return;
    }
    const lease = acquisition.lease;

    const generation = ++runtimeGenerationRef.current;
    pendingJoinGenerationRef.current = generation;
    dispatch({ type: "action_started", actionState: "starting" });

    let localStream: MediaStream | null = null;
    try {
      localStream = await ensureLocalAudioStream(generation);
      await refreshRTCConfiguration();
      if (runtimeGenerationRef.current !== generation) {
        return;
      }
      const response = await gatewayClient.startCall(token, {
        kind: "direct",
        directChatId: chat.id,
      });
      if (runtimeGenerationRef.current !== generation) {
        await compensateCancelledJoin(response.call.id, chat.id, lease);
        return;
      }
      dispatch({ type: "action_finished" });
      localStreamRef.current = localStream;
      await bootstrapJoinedCall(response.call, response.selfParticipant);
    } catch (error) {
      if (runtimeGenerationRef.current !== generation) {
        return;
      }
      if (localStream !== null) {
        clearPeerRecoveryPlan();
        teardownDirectCallRuntime({
          localStream: localStreamRef.current ?? localStream,
          peerConnection: peerConnectionRef.current,
          remoteStream: remoteStreamRef.current,
        });
        localStreamRef.current = null;
        localJoinedCallIdRef.current = null;
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
    } finally {
      lease.release();
      if (pendingJoinGenerationRef.current === generation) {
        pendingJoinGenerationRef.current = null;
      }
    }
  }

  async function joinCall() {
    const currentCall = stateRef.current.call;
    if (
      !sessionActiveRef.current ||
      !enabled ||
      chat === null ||
      currentCall === null ||
      !isDirectChatSupported ||
      pendingJoinGenerationRef.current !== null
    ) {
      return;
    }

    const acquisition = joinCoordinator.acquire(currentUserId, currentCall.id);
    if (acquisition.lease === null) {
      dispatch({ type: "failure", message: acquisition.message });
      void runRefreshDirectChatCall(false);
      return;
    }
    const lease = acquisition.lease;

    const generation = ++runtimeGenerationRef.current;
    pendingJoinGenerationRef.current = generation;
    dispatch({ type: "action_started", actionState: "joining" });

    let localStream: MediaStream | null = null;
    try {
      localStream = await ensureLocalAudioStream(generation);
      await refreshRTCConfiguration();
      if (runtimeGenerationRef.current !== generation) {
        return;
      }
      const response = await gatewayClient.joinCall(token, currentCall.id);
      if (runtimeGenerationRef.current !== generation) {
        await compensateCancelledJoin(response.call.id, chat.id, lease);
        return;
      }
      dispatch({ type: "action_finished" });
      localStreamRef.current = localStream;
      await bootstrapJoinedCall(response.call, response.selfParticipant);
    } catch (error) {
      if (runtimeGenerationRef.current !== generation) {
        return;
      }
      if (localStream !== null) {
        clearPeerRecoveryPlan();
        teardownDirectCallRuntime({
          localStream: localStreamRef.current ?? localStream,
          peerConnection: peerConnectionRef.current,
          remoteStream: remoteStreamRef.current,
        });
        localStreamRef.current = null;
        localJoinedCallIdRef.current = null;
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
    } finally {
      lease.release();
      if (pendingJoinGenerationRef.current === generation) {
        pendingJoinGenerationRef.current = null;
      }
    }
  }

  async function leaveCall() {
    const currentCall = stateRef.current.call;
    if (currentCall === null) {
      disposeLocalRuntime();
      return;
    }

    dispatch({ type: "action_started", actionState: "leaving" });
    const callId = currentCall.id;
    disposeLocalRuntime();
    dispatch({ type: "action_finished" });
    queueRtcExitMutation(callId, () => gatewayClient.leaveCall(token, callId), true);
  }

  async function endCall() {
    const currentCall = stateRef.current.call;
    if (currentCall === null) {
      disposeLocalRuntime();
      return;
    }

    dispatch({ type: "action_started", actionState: "ending" });
    const callId = currentCall.id;
    disposeLocalRuntime();
    dispatch({ type: "action_finished" });
    queueRtcExitMutation(callId, () => gatewayClient.endCall(token, callId), false);
  }

  function dismissError() {
    dispatch({ type: "clear_error" });
  }

  const retryRemoteAudioPlayback = useCallback(async (audioElement: HTMLAudioElement | null) => {
    const stream = audioElement?.srcObject;
    if (audioElement === null || stream == null) {
      return;
    }

    try {
      await audioElement.play();
      if (audioElement.srcObject !== stream || remoteStreamRef.current !== stream) {
        return;
      }
      dispatch({
        type: "remote_audio_state_replaced",
        remoteAudioState: stateRef.current.remoteAudioAvailable ? "ready" : "idle",
        remoteAudioAvailable: stateRef.current.remoteAudioAvailable,
      });
    } catch {
      if (audioElement.srcObject !== stream || remoteStreamRef.current !== stream) {
        return;
      }
      dispatch({
        type: "remote_audio_state_replaced",
        remoteAudioState: "blocked",
        remoteAudioAvailable: stateRef.current.remoteAudioAvailable,
      });
    }
  }, []);

  useEffect(() => {
    if (!enabled || activeChatID === null || !isDirectChatSupported) {
      sessionActiveRef.current = false;
      dispatch({ type: "sync_succeeded", call: null, participants: [] });
      return;
    }

    sessionActiveRef.current = true;
    dispatch({ type: "sync_started" });
    void runRefreshDirectChatCall(true);

    return () => {
      sessionActiveRef.current = false;
      disposeLocalRuntime();
    };
  }, [
    activeChatID,
    disposeLocalRuntime,
    enabled,
    isDirectChatSupported,
    runRefreshDirectChatCall,
    token,
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
    if (!enabled || activeChatID === null || !isDirectChatSupported) {
      return;
    }

    return subscribeRealtimeLifecycleEvents((event) => {
      if (event.type === "realtime.connected") {
        void runRefreshDirectChatCall(false);
      }
    });
  }, [activeChatID, enabled, isDirectChatSupported, runRefreshDirectChatCall]);

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
      clearPeerRecoveryPlan();
      if (state.localJoinedCallId === null) {
        localJoinedCallIdRef.current = null;
      }
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
      clearPeerRecoveryPlan();
      resetPeerRuntime();
      if (state.peerConnectionState !== "waiting_for_peer") {
        dispatch({
          type: "peer_state_replaced",
          peerConnectionState: "waiting_for_peer",
        });
      }
      return;
    }

    if (
      shouldDelayPeerRuntimeRecovery(
        peerRecoveryPlanRef.current,
        joinedCall.id,
        nextRemoteParticipant.userId,
        Date.now(),
      )
    ) {
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
    clearPeerRecoveryPlan,
    disposeLocalRuntime,
    ensurePeerConnection,
    currentUserId,
    resetPeerRuntime,
    state,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      joinedCallID === null ||
      state.localJoinedCallId !== joinedCallID ||
      typeof window === "undefined"
    ) {
      return;
    }

    let disposed = false;
    const sendParticipantHeartbeat = async () => {
      if (
        disposed ||
        stateRef.current.call?.id !== joinedCallID ||
        localJoinedCallIdRef.current !== joinedCallID
      ) {
        return;
      }

      try {
        await gatewayClient.touchCallParticipant(token, joinedCallID);
      } catch (error) {
        if (isGatewayErrorCode(error, "unauthenticated")) {
          onUnauthenticatedRef.current();
          return;
        }

        if (
          isGatewayErrorCode(error, "failed_precondition") ||
          isGatewayErrorCode(error, "not_found")
        ) {
          await runRefreshDirectChatCall(false);
        }
      }
    };

    void sendParticipantHeartbeat();
    const intervalId = window.setInterval(() => {
      void sendParticipantHeartbeat();
    }, directCallParticipantHeartbeatIntervalMs);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [
    enabled,
    joinedCallID,
    runRefreshDirectChatCall,
    state.localJoinedCallId,
    token,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      joinedCallID === null ||
      state.localJoinedCallId !== joinedCallID ||
      typeof window === "undefined"
    ) {
      return;
    }

    const leaveOnPageHide = () => {
      sendRtcLeaveCallKeepalive(token, joinedCallID, directCallGatewayBaseUrl);
    };

    window.addEventListener("pagehide", leaveOnPageHide);

    return () => {
      window.removeEventListener("pagehide", leaveOnPageHide);
    };
  }, [enabled, joinedCallID, state.localJoinedCallId, token]);

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
