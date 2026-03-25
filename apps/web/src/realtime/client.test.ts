import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRealtimeProtocols,
  clearPendingRealtimeClientEnvelopesForTest,
  connectRealtime,
  resolveRealtimeUrl,
  sendRealtimeClientEnvelope,
} from "./client";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static latestInstance: FakeWebSocket | null = null;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Array<(event?: unknown) => void>>();

  constructor(
    public readonly url: string,
    public readonly protocols?: string | string[],
  ) {
    FakeWebSocket.latestInstance = this;
  }

  addEventListener(type: string, listener: (event?: unknown) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  emit(type: string, event?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  clearPendingRealtimeClientEnvelopesForTest();
  FakeWebSocket.latestInstance = null;
  vi.restoreAllMocks();
  if (originalWebSocket === undefined) {
    // @ts-expect-error тестовый cleanup для окружения без WebSocket
    delete globalThis.WebSocket;
    return;
  }

  globalThis.WebSocket = originalWebSocket;
});

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

  it("flushes queued client envelopes after websocket open", () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const connection = connectRealtime({
      token: "v1.session.secret",
      baseUrl: "https://edge.aerochat.test/api",
    });

    expect(
      sendRealtimeClientEnvelope({
        type: "connection.bind_crypto_device",
        payload: {
          cryptoDeviceId: "crypto-1",
        },
      }),
    ).toBe(false);

    expect(FakeWebSocket.latestInstance?.sent).toEqual([]);

    if (FakeWebSocket.latestInstance === null) {
      throw new Error("expected fake websocket instance");
    }

    FakeWebSocket.latestInstance.readyState = FakeWebSocket.OPEN;
    FakeWebSocket.latestInstance.emit("open");

    expect(FakeWebSocket.latestInstance.sent).toEqual([
      JSON.stringify({
        type: "connection.bind_crypto_device",
        payload: {
          cryptoDeviceId: "crypto-1",
        },
      }),
    ]);

    connection.close();
  });
});
