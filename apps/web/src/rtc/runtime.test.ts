import { describe, expect, it, vi } from "vitest";
import {
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
});
