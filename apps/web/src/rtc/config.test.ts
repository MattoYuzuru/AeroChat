import { describe, expect, it } from "vitest";
import { resolveDirectCallRTCConfiguration } from "./config";

describe("resolveDirectCallRTCConfiguration", () => {
  it("falls back to the default STUN server when env is empty", () => {
    expect(resolveDirectCallRTCConfiguration({})).toEqual({
      iceServers: [
        {
          urls: ["stun:stun.cloudflare.com:3478"],
        },
      ],
    });
  });

  it("parses multiple ICE URLs from a comma-separated env value", () => {
    expect(
      resolveDirectCallRTCConfiguration({
        VITE_RTC_ICE_SERVER_URLS:
          "stun:stun.cloudflare.com:3478, turns:turn.example.com:5349",
      }),
    ).toEqual({
      iceServers: [
        {
          urls: ["stun:stun.cloudflare.com:3478", "turns:turn.example.com:5349"],
        },
      ],
    });
  });

  it("attaches TURN credentials when both username and credential are present", () => {
    expect(
      resolveDirectCallRTCConfiguration({
        VITE_RTC_ICE_SERVER_URLS: "turns:turn.example.com:5349",
        VITE_RTC_TURN_USERNAME: "aerochat",
        VITE_RTC_TURN_CREDENTIAL: "secret",
      }),
    ).toEqual({
      iceServers: [
        {
          urls: ["turns:turn.example.com:5349"],
          username: "aerochat",
          credential: "secret",
        },
      ],
    });
  });

  it("ignores partial TURN credentials and keeps the ICE server usable", () => {
    expect(
      resolveDirectCallRTCConfiguration({
        VITE_RTC_ICE_SERVER_URLS: "turns:turn.example.com:5349",
        VITE_RTC_TURN_USERNAME: "aerochat",
      }),
    ).toEqual({
      iceServers: [
        {
          urls: ["turns:turn.example.com:5349"],
        },
      ],
    });
  });
});
