interface TrackLike {
  stop(): void;
}

interface MediaStreamLike {
  getTracks(): TrackLike[];
}

interface PeerConnectionLike {
  close(): void;
}

interface ICECapablePeerConnectionLike {
  connectionState?: RTCPeerConnectionState;
  iceConnectionState?: RTCIceConnectionState;
  remoteDescription: unknown;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
}

interface SessionDescriptionCapablePeerConnectionLike {
  remoteDescription: RTCSessionDescriptionInit | null;
  currentRemoteDescription?: RTCSessionDescriptionInit | null;
  pendingRemoteDescription?: RTCSessionDescriptionInit | null;
}

export interface DirectCallPeerRecoveryPlan {
  callId: string;
  remoteUserId: string;
  attempts: number;
  blockedUntilMs: number;
}

interface DirectCallPeerRecoveryOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
}

interface DirectCallPeerRuntimeInput {
  peerConnection: PeerConnectionLike | null;
  remoteStream: MediaStreamLike | null;
}

interface DirectCallRuntimeInput extends DirectCallPeerRuntimeInput {
  localStream: MediaStreamLike | null;
}

export function stopMediaStreamTracks(stream: MediaStreamLike | null) {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
}

export function teardownDirectCallPeerRuntime(input: DirectCallPeerRuntimeInput) {
  input.peerConnection?.close();
  stopMediaStreamTracks(input.remoteStream);
}

export function teardownDirectCallRuntime(input: DirectCallRuntimeInput) {
  teardownDirectCallPeerRuntime(input);
  stopMediaStreamTracks(input.localStream);
}

export async function flushPendingRemoteICECandidates(
  peerConnection: ICECapablePeerConnectionLike,
  candidates: RTCIceCandidateInit[],
): Promise<RTCIceCandidateInit[]> {
  if (peerConnection.remoteDescription === null || candidates.length === 0) {
    return candidates;
  }

  for (const candidate of candidates) {
    await peerConnection.addIceCandidate(candidate);
  }

  return [];
}

export async function queueOrApplyRemoteICECandidate(
  peerConnection: ICECapablePeerConnectionLike,
  pendingCandidates: RTCIceCandidateInit[],
  candidate: RTCIceCandidateInit,
): Promise<RTCIceCandidateInit[]> {
  if (peerConnection.remoteDescription === null) {
    return [...pendingCandidates, candidate];
  }

  await peerConnection.addIceCandidate(candidate);
  return pendingCandidates;
}

export function shouldRecoverPeerConnectionAfterDisconnect(
  peerConnection: Pick<ICECapablePeerConnectionLike, "connectionState" | "iceConnectionState">,
): boolean {
  return (
    peerConnection.connectionState !== "connected" &&
    peerConnection.connectionState !== "closed" &&
    peerConnection.iceConnectionState !== "connected" &&
    peerConnection.iceConnectionState !== "completed" &&
    peerConnection.iceConnectionState !== "closed"
  );
}

export function hasMatchingRemoteSessionDescription(
  peerConnection: SessionDescriptionCapablePeerConnectionLike,
  description: RTCSessionDescriptionInit,
): boolean {
  return [
    peerConnection.pendingRemoteDescription,
    peerConnection.currentRemoteDescription,
    peerConnection.remoteDescription,
  ].some((currentDescription) =>
    currentDescription?.type === description.type && currentDescription.sdp === description.sdp
  );
}

export function buildNextPeerRecoveryPlan(
  previousPlan: DirectCallPeerRecoveryPlan | null,
  callId: string,
  remoteUserId: string,
  nowMs: number,
  options: DirectCallPeerRecoveryOptions = {},
): DirectCallPeerRecoveryPlan | null {
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const maxAttempts = options.maxAttempts ?? 4;
  const isSamePeer =
    previousPlan !== null &&
    previousPlan.callId === callId &&
    previousPlan.remoteUserId === remoteUserId;
  const attempts = isSamePeer ? previousPlan.attempts + 1 : 1;

  if (attempts > maxAttempts) {
    return null;
  }

  const nextDelayMs = Math.min(baseDelayMs * 2 ** (attempts - 1), maxDelayMs);
  return {
    callId,
    remoteUserId,
    attempts,
    blockedUntilMs: nowMs + nextDelayMs,
  };
}

export function shouldDelayPeerRuntimeRecovery(
  plan: DirectCallPeerRecoveryPlan | null,
  callId: string,
  remoteUserId: string,
  nowMs: number,
): boolean {
  if (plan === null) {
    return false;
  }

  return (
    plan.callId === callId &&
    plan.remoteUserId === remoteUserId &&
    nowMs < plan.blockedUntilMs
  );
}
