import { describe, expect, it } from "vitest";
import {
  decodeRTCIceCandidatePayload,
  decodeRTCSessionDescriptionPayload,
  encodeRTCIceCandidatePayload,
  encodeRTCSessionDescriptionPayload,
} from "./signal";

describe("rtc signal payload helpers", () => {
  it("round-trips offer payloads through opaque bytes", () => {
    const payload = encodeRTCSessionDescriptionPayload({
      type: "offer",
      sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
    });

    expect(decodeRTCSessionDescriptionPayload(payload, "offer")).toEqual({
      type: "offer",
      sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
    });
  });

  it("round-trips ice candidates through opaque bytes", () => {
    const payload = encodeRTCIceCandidatePayload({
      candidate: "candidate:1 1 udp 123 127.0.0.1 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: "ufrag-1",
    });

    expect(decodeRTCIceCandidatePayload(payload)).toEqual({
      candidate: "candidate:1 1 udp 123 127.0.0.1 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: "ufrag-1",
    });
  });

  it("rejects malformed signal payloads", () => {
    expect(
      decodeRTCSessionDescriptionPayload(new TextEncoder().encode("{"), "offer"),
    ).toBeNull();
    expect(
      decodeRTCIceCandidatePayload(new TextEncoder().encode("{\"candidate\":\"\"}")),
    ).toBeNull();
  });
});
