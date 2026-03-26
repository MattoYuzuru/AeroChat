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
  remoteDescription: unknown;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
}

interface SessionDescriptionCapablePeerConnectionLike {
  remoteDescription: RTCSessionDescriptionInit | null;
  currentRemoteDescription?: RTCSessionDescriptionInit | null;
  pendingRemoteDescription?: RTCSessionDescriptionInit | null;
}

export interface DirectCallPeerFailureMarker {
  callId: string;
  remoteUserId: string;
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

export function shouldBlockPeerRuntimeAfterFailure(
  marker: DirectCallPeerFailureMarker | null,
  callId: string,
  remoteUserId: string,
): boolean {
  if (marker === null) {
    return false;
  }

  return marker.callId === callId && marker.remoteUserId === remoteUserId;
}
