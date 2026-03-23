interface TrackLike {
  stop(): void;
}

interface MediaStreamLike {
  getTracks(): TrackLike[];
}

interface PeerConnectionLike {
  close(): void;
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
