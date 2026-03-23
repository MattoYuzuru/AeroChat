import { describe, expect, it, vi } from "vitest";
import {
  flushPendingRemoteICECandidates,
  queueOrApplyRemoteICECandidate,
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
});
