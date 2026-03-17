import { resolveGatewayBaseUrl } from "../gateway/client";

const realtimeProtocol = "aerochat.realtime.v1";
const realtimeAuthProtocolPrefix = "aerochat.auth.";
const reconnectBaseDelayMs = 1000;
const reconnectMaxDelayMs = 10000;

export interface RealtimeEnvelope {
  id: string;
  type: string;
  issuedAt: string;
  payload?: unknown;
}

export interface RealtimeConnection {
  close(): void;
}

export interface RealtimeConnectionOptions {
  token: string;
  baseUrl?: string;
  onEvent?: (event: RealtimeEnvelope) => void;
}

export function connectRealtime(
  options: RealtimeConnectionOptions,
): RealtimeConnection {
  const token = options.token.trim();
  if (token === "" || typeof WebSocket === "undefined") {
    return {
      close() {},
    };
  }

  const url = resolveRealtimeUrl(options.baseUrl);
  const protocols = buildRealtimeProtocols(token);
  let disposed = false;
  let socket: WebSocket | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: number | null = null;

  function clearReconnectTimer() {
    if (reconnectTimer === null) {
      return;
    }

    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect() {
    if (disposed) {
      return;
    }

    const delay = Math.min(
      reconnectBaseDelayMs * 2 ** Math.min(reconnectAttempt, 4),
      reconnectMaxDelayMs,
    );
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  }

  function open() {
    if (disposed) {
      return;
    }

    clearReconnectTimer();

    const nextSocket = new WebSocket(url, protocols);
    nextSocket.addEventListener("open", () => {
      reconnectAttempt = 0;
    });
    nextSocket.addEventListener("message", (event) => {
      const envelope = parseRealtimeEnvelope(event.data);
      if (envelope !== null) {
        options.onEvent?.(envelope);
      }
    });
    nextSocket.addEventListener("close", () => {
      if (socket === nextSocket) {
        socket = null;
      }
      scheduleReconnect();
    });
    nextSocket.addEventListener("error", () => {});

    socket = nextSocket;
  }

  open();

  return {
    close() {
      disposed = true;
      clearReconnectTimer();
      const activeSocket = socket;
      socket = null;
      activeSocket?.close(1000, "client shutdown");
    },
  };
}

export function resolveRealtimeUrl(
  baseUrl = resolveGatewayBaseUrl(),
  origin = resolveBrowserOrigin(),
): string {
  const gatewayURL = new URL(`${normalizeBaseUrl(baseUrl)}/realtime`, origin);
  gatewayURL.protocol = gatewayURL.protocol === "https:" ? "wss:" : "ws:";

  return gatewayURL.toString();
}

export function buildRealtimeProtocols(token: string): string[] {
  const trimmedToken = token.trim();

  return [realtimeProtocol, `${realtimeAuthProtocolPrefix}${trimmedToken}`];
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed === "") {
    return "/api";
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function resolveBrowserOrigin(): string {
  if (typeof window !== "undefined" && typeof window.location?.origin === "string") {
    return window.location.origin;
  }

  return "http://localhost";
}

function parseRealtimeEnvelope(input: unknown): RealtimeEnvelope | null {
  if (typeof input !== "string" || input.trim() === "") {
    return null;
  }

  try {
    const parsed = JSON.parse(input) as RealtimeEnvelope;
    if (typeof parsed.type !== "string" || parsed.type.trim() === "") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
