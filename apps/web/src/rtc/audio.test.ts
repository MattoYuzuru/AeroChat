import { describe, expect, it, vi } from "vitest";
import {
  applyDirectCallTrackContentHint,
  buildDirectCallAudioConstraints,
  tuneDirectCallSenderForVoice,
} from "./audio";

describe("rtc audio helpers", () => {
  it("builds conservative voice-oriented audio constraints", () => {
    expect(
      buildDirectCallAudioConstraints({
        autoGainControl: true,
        channelCount: true,
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: true,
        sampleSize: true,
      }),
    ).toEqual({
      autoGainControl: true,
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
    });
  });

  it("omits unsupported numeric constraints but keeps safe voice processing defaults", () => {
    expect(
      buildDirectCallAudioConstraints({
        autoGainControl: false,
        channelCount: false,
        echoCancellation: false,
        noiseSuppression: false,
        sampleRate: false,
        sampleSize: false,
      }),
    ).toEqual({});
  });

  it("marks local audio tracks as speech-oriented when the browser allows it", () => {
    const track = {
      kind: "audio",
      contentHint: "",
    };

    applyDirectCallTrackContentHint(track);

    expect(track.contentHint).toBe("speech");
  });

  it("falls back to a smaller sender parameter patch when the browser rejects advanced options", async () => {
    const baseParameters: RTCRtpSendParameters = {
      codecs: [],
      encodings: [{}],
      headerExtensions: [],
      rtcp: {},
      transactionId: "voice-tuning",
    };
    const sender = {
      getParameters: vi.fn(() => baseParameters),
      setParameters: vi.fn()
        .mockRejectedValueOnce(new Error("networkPriority unsupported"))
        .mockRejectedValueOnce(new Error("priority unsupported"))
        .mockResolvedValueOnce(undefined),
    };

    const applied = await tuneDirectCallSenderForVoice(sender);

    expect(applied).toBe(true);
    expect(sender.setParameters).toHaveBeenCalledTimes(3);
    expect(sender.setParameters).toHaveBeenLastCalledWith({
      codecs: [],
      encodings: [
        {
          maxBitrate: 96000,
        },
      ],
      headerExtensions: [],
      rtcp: {},
      transactionId: "voice-tuning",
    });
  });
});
