import { describe, expect, it, vi } from "vitest";
import {
  buildNextPeerRecoveryPlan,
  flushPendingRemoteICECandidates,
  hasMatchingRemoteSessionDescription,
  queueOrApplyRemoteICECandidate,
  shouldRecoverPeerConnectionAfterDisconnect,
  shouldDelayPeerRuntimeRecovery,
  stopMediaStreamTracks,
  teardownDirectCallPeerRuntime,
  teardownDirectCallRuntime,
} from "./runtime";

function createStreamLike(trackCount = 2) {
  const tracks = Array.from({ length: trackCount }, () => ({
    stop: vi.fn(),
  }));

  return {
    stream: {
      getTracks() {
        return tracks;
      },
    },
    tracks,
  };
}

describe("rtc runtime cleanup helpers", () => {
  it("stops every track in a media stream", () => {
    const { stream, tracks } = createStreamLike();

    stopMediaStreamTracks(stream);

    expect(tracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(tracks[1]?.stop).toHaveBeenCalledTimes(1);
  });

  it("tears down peer runtime without touching local stream", () => {
    const { stream: remoteStream, tracks: remoteTracks } = createStreamLike(1);
    const peerConnection = {
      close: vi.fn(),
    };

    teardownDirectCallPeerRuntime({
      peerConnection,
      remoteStream,
    });

    expect(peerConnection.close).toHaveBeenCalledTimes(1);
    expect(remoteTracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it("tears down local stream, peer connection and remote stream together", () => {
    const { stream: localStream, tracks: localTracks } = createStreamLike(1);
    const { stream: remoteStream, tracks: remoteTracks } = createStreamLike(1);
    const peerConnection = {
      close: vi.fn(),
    };

    teardownDirectCallRuntime({
      localStream,
      peerConnection,
      remoteStream,
    });

    expect(peerConnection.close).toHaveBeenCalledTimes(1);
    expect(localTracks[0]?.stop).toHaveBeenCalledTimes(1);
    expect(remoteTracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it("queues remote ICE candidates until remote description is installed", async () => {
    const peerConnection = {
      remoteDescription: null,
      addIceCandidate: vi.fn(async () => {}),
    };
    const candidate = {
      candidate: "candidate:1 1 UDP 1 127.0.0.1 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };

    const nextQueue = await queueOrApplyRemoteICECandidate(peerConnection, [], candidate);

    expect(nextQueue).toEqual([candidate]);
    expect(peerConnection.addIceCandidate).not.toHaveBeenCalled();
  });

  it("flushes queued ICE candidates after remote description is installed", async () => {
    const peerConnection = {
      remoteDescription: {},
      addIceCandidate: vi.fn(async () => {}),
    };
    const candidates = [
      {
        candidate: "candidate:1 1 UDP 1 127.0.0.1 5000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
      {
        candidate: "candidate:2 1 UDP 1 127.0.0.1 5001 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    ];

    const nextQueue = await flushPendingRemoteICECandidates(peerConnection, candidates);

    expect(nextQueue).toEqual([]);
    expect(peerConnection.addIceCandidate).toHaveBeenCalledTimes(2);
  });

  it("detects a duplicated remote offer across pending/current descriptions", () => {
    const description = {
      type: "offer" as const,
      sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
    };
    const peerConnection = {
      remoteDescription: null,
      currentRemoteDescription: description,
      pendingRemoteDescription: null,
    };

    expect(hasMatchingRemoteSessionDescription(peerConnection, description)).toBe(true);
  });

  it("does not mark a different SDP as a duplicated remote description", () => {
    const peerConnection = {
      remoteDescription: {
        type: "offer" as const,
        sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
      },
      currentRemoteDescription: null,
      pendingRemoteDescription: null,
    };

    expect(
      hasMatchingRemoteSessionDescription(peerConnection, {
        type: "offer",
        sdp: "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\n",
      }),
    ).toBe(false);
  });

  it("builds an exponential backoff recovery plan for the same peer", () => {
    const firstPlan = buildNextPeerRecoveryPlan(null, "call-1", "user-2", 1_000);
    const secondPlan = buildNextPeerRecoveryPlan(firstPlan, "call-1", "user-2", 2_000);

    expect(firstPlan).toEqual({
      attempts: 1,
      blockedUntilMs: 2_000,
      callId: "call-1",
      remoteUserId: "user-2",
    });
    expect(secondPlan).toEqual({
      attempts: 2,
      blockedUntilMs: 4_000,
      callId: "call-1",
      remoteUserId: "user-2",
    });
  });

  it("stops automatic recovery after the configured attempt budget", () => {
    expect(
      buildNextPeerRecoveryPlan(
        {
          attempts: 4,
          blockedUntilMs: 10_000,
          callId: "call-1",
          remoteUserId: "user-2",
        },
        "call-1",
        "user-2",
        11_000,
      ),
    ).toBeNull();
  });

  it("delays peer runtime recovery only while the matching plan is still cooling down", () => {
    expect(
      shouldDelayPeerRuntimeRecovery(
        {
          attempts: 2,
          blockedUntilMs: 5_000,
          callId: "call-1",
          remoteUserId: "user-2",
        },
        "call-1",
        "user-2",
        4_500,
      ),
    ).toBe(true);
    expect(
      shouldDelayPeerRuntimeRecovery(
        {
          attempts: 2,
          blockedUntilMs: 5_000,
          callId: "call-1",
          remoteUserId: "user-2",
        },
        "call-2",
        "user-2",
        4_500,
      ),
    ).toBe(false);
    expect(
      shouldDelayPeerRuntimeRecovery(
        {
          attempts: 2,
          blockedUntilMs: 5_000,
          callId: "call-1",
          remoteUserId: "user-2",
        },
        "call-1",
        "user-2",
        5_000,
      ),
    ).toBe(false);
  });

  it("keeps waiting after a transient disconnect while the peer is already recovering", () => {
    expect(
      shouldRecoverPeerConnectionAfterDisconnect({
        connectionState: "disconnected",
        iceConnectionState: "checking",
      }),
    ).toBe(true);
  });

  it("skips forced recovery after the peer connection already came back", () => {
    expect(
      shouldRecoverPeerConnectionAfterDisconnect({
        connectionState: "connected",
        iceConnectionState: "completed",
      }),
    ).toBe(false);
    expect(
      shouldRecoverPeerConnectionAfterDisconnect({
        connectionState: "closed",
        iceConnectionState: "closed",
      }),
    ).toBe(false);
  });
});
