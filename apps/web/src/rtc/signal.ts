const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface RTCSessionDescriptionWire {
  type?: string;
  sdp?: string;
}

interface RTCIceCandidateWire {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export function encodeRTCSessionDescriptionPayload(
  description: RTCSessionDescriptionInit,
): Uint8Array {
  return textEncoder.encode(
    JSON.stringify({
      type: description.type,
      sdp: description.sdp ?? "",
    }),
  );
}

export function decodeRTCSessionDescriptionPayload(
  payload: Uint8Array,
  expectedType: "offer" | "answer",
): RTCSessionDescriptionInit | null {
  const parsed = parseRTCSignalJSON<RTCSessionDescriptionWire>(payload);
  if (!parsed) {
    return null;
  }

  const type = parsed.type === "offer" || parsed.type === "answer"
    ? parsed.type
    : expectedType;
  const sdp = typeof parsed.sdp === "string" ? parsed.sdp : "";
  if (sdp.trim() === "") {
    return null;
  }

  return {
    type,
    sdp,
  };
}

export function encodeRTCIceCandidatePayload(
  candidate: RTCIceCandidateInit,
): Uint8Array {
  return textEncoder.encode(
    JSON.stringify({
      candidate: candidate.candidate ?? "",
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
      usernameFragment: candidate.usernameFragment ?? null,
    }),
  );
}

export function decodeRTCIceCandidatePayload(
  payload: Uint8Array,
): RTCIceCandidateInit | null {
  const parsed = parseRTCSignalJSON<RTCIceCandidateWire>(payload);
  if (!parsed || typeof parsed.candidate !== "string" || parsed.candidate.trim() === "") {
    return null;
  }

  return {
    candidate: parsed.candidate,
    sdpMid: parsed.sdpMid ?? null,
    sdpMLineIndex: parsed.sdpMLineIndex ?? null,
    usernameFragment: parsed.usernameFragment ?? null,
  };
}

function parseRTCSignalJSON<T>(payload: Uint8Array): T | null {
  if (payload.byteLength === 0) {
    return null;
  }

  try {
    return JSON.parse(textDecoder.decode(payload)) as T;
  } catch {
    return null;
  }
}
