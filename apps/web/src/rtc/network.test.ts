import { describe, expect, it, vi } from "vitest";
import {
  buildRtcControlServicePath,
  sendRtcLeaveCallKeepalive,
} from "./network";

describe("rtc network helpers", () => {
  it("builds stable rtc-control paths regardless of trailing slash", () => {
    expect(buildRtcControlServicePath("/api", "LeaveCall")).toBe(
      "/api/aerochat.rtc.v1.RtcControlService/LeaveCall",
    );
    expect(buildRtcControlServicePath("/api/", "LeaveCall")).toBe(
      "/api/aerochat.rtc.v1.RtcControlService/LeaveCall",
    );
  });

  it("skips keepalive leave calls when token or call id is empty", () => {
    expect(sendRtcLeaveCallKeepalive("", "call-1", "/api", vi.fn())).toBe(false);
    expect(sendRtcLeaveCallKeepalive("token-1", "", "/api", vi.fn())).toBe(false);
  });

  it("sends a keepalive leave request with the gateway auth headers", async () => {
    const fetchLike = vi.fn(async () => ({}));

    const scheduled = sendRtcLeaveCallKeepalive(
      " token-1 ",
      " call-1 ",
      "/api",
      fetchLike,
    );

    expect(scheduled).toBe(true);
    expect(fetchLike).toHaveBeenCalledTimes(1);
    expect(fetchLike).toHaveBeenCalledWith(
      "/api/aerochat.rtc.v1.RtcControlService/LeaveCall",
      {
        body: JSON.stringify({
          callId: "call-1",
        }),
        headers: {
          Accept: "application/json",
          Authorization: "Bearer token-1",
          "Connect-Protocol-Version": "1",
          "Content-Type": "application/json",
        },
        keepalive: true,
        method: "POST",
      },
    );
  });
});
