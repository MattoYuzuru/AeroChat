const preferredDirectCallAudioBitrateBps = 96_000;
const preferredDirectCallAudioSampleRateHz = 48_000;
const preferredDirectCallAudioSampleSizeBits = 16;
const preferredDirectCallAudioChannelCount = 1;
const directCallTrackContentHint = "speech";

type DirectCallSupportedAudioConstraints = Pick<
  MediaTrackSupportedConstraints,
  | "autoGainControl"
  | "channelCount"
  | "echoCancellation"
  | "noiseSuppression"
  | "sampleRate"
  | "sampleSize"
>;

interface DirectCallTrackLike {
  kind?: string;
  contentHint?: string;
}

interface DirectCallSenderLike {
  getParameters(): RTCRtpSendParameters;
  setParameters(params: RTCRtpSendParameters): Promise<unknown>;
}

export function buildDirectCallAudioConstraints(
  supportedConstraints: DirectCallSupportedAudioConstraints = {},
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {};

  if (supportedConstraints.echoCancellation !== false) {
    constraints.echoCancellation = true;
  }
  if (supportedConstraints.noiseSuppression !== false) {
    constraints.noiseSuppression = true;
  }
  if (supportedConstraints.autoGainControl !== false) {
    constraints.autoGainControl = true;
  }
  if (supportedConstraints.channelCount) {
    constraints.channelCount = { ideal: preferredDirectCallAudioChannelCount };
  }
  if (supportedConstraints.sampleRate) {
    constraints.sampleRate = { ideal: preferredDirectCallAudioSampleRateHz };
  }
  if (supportedConstraints.sampleSize) {
    constraints.sampleSize = { ideal: preferredDirectCallAudioSampleSizeBits };
  }

  return constraints;
}

export function applyDirectCallTrackContentHint(track: DirectCallTrackLike | null) {
  if (track === null || track.kind !== "audio" || !("contentHint" in track)) {
    return;
  }

  try {
    track.contentHint = directCallTrackContentHint;
  } catch {
    // Некоторые браузеры expose'ят поле, но запрещают менять hint для текущего capture path.
  }
}

export async function tuneDirectCallSenderForVoice(
  sender: DirectCallSenderLike | null,
): Promise<boolean> {
  if (sender === null) {
    return false;
  }

  const baseParameters = sender.getParameters();
  for (const candidate of buildDirectCallSenderParameterVariants(baseParameters)) {
    try {
      await sender.setParameters(candidate);
      return true;
    } catch {
      // Некоторые браузеры принимают только часть voice-tuning параметров. Идём по консервативному fallback.
    }
  }

  return false;
}

function buildDirectCallSenderParameterVariants(
  baseParameters: RTCRtpSendParameters,
): RTCRtpSendParameters[] {
  const variants: Array<Pick<RTCRtpEncodingParameters, "maxBitrate" | "networkPriority" | "priority">> = [
    {
      maxBitrate: preferredDirectCallAudioBitrateBps,
      priority: "high",
      networkPriority: "high",
    },
    {
      maxBitrate: preferredDirectCallAudioBitrateBps,
      priority: "high",
    },
    {
      maxBitrate: preferredDirectCallAudioBitrateBps,
    },
  ];

  return variants.map((patch) => {
    const nextParameters: RTCRtpSendParameters = {
      ...baseParameters,
      encodings:
        baseParameters.encodings?.map((encoding) => ({
          ...encoding,
          ...patch,
        })) ?? [{ ...patch }],
    };

    if (nextParameters.encodings.length === 0) {
      nextParameters.encodings = [{ ...patch }];
    }

    return nextParameters;
  });
}
