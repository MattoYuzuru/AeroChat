import { describe, expect, it } from "vitest";
import { buildRealtimeProtocols, resolveRealtimeUrl } from "./client";

describe("realtime client helpers", () => {
  it("builds websocket auth protocols from the gateway token", () => {
    expect(buildRealtimeProtocols("v1.session.secret")).toEqual([
      "aerochat.realtime.v1",
      "aerochat.auth.v1.session.secret",
    ]);
  });

  it("resolves relative gateway base url into websocket url", () => {
    expect(resolveRealtimeUrl("/api", "http://localhost:3000")).toBe(
      "ws://localhost:3000/api/realtime",
    );
  });

  it("keeps absolute https gateway url and switches it to wss", () => {
    expect(resolveRealtimeUrl("https://edge.aerochat.test/api", "http://localhost:3000")).toBe(
      "wss://edge.aerochat.test/api/realtime",
    );
  });
});
