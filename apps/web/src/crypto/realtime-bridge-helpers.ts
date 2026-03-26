import type { CryptoContextState } from "./runtime-context";
import type { RealtimeClientEnvelope } from "../realtime/client";
import type { RealtimeEnvelope } from "../realtime/client";

const bindCryptoDeviceEventType = "connection.bind_crypto_device";
const cryptoDeviceBoundEventType = "connection.crypto_device.bound";

export function buildBindCryptoDeviceRealtimeEnvelope(
  cryptoDeviceId: string,
): RealtimeClientEnvelope {
  return {
    type: bindCryptoDeviceEventType,
    payload: {
      cryptoDeviceId,
    },
  };
}

export function resolveActiveRealtimeCryptoDeviceId(
  state: CryptoContextState,
): string | null {
  if (state.status !== "ready") {
    return null;
  }

  const localDevice = state.snapshot?.localDevice;
  if (localDevice === null || localDevice === undefined || localDevice.status !== "active") {
    return null;
  }

  return localDevice.cryptoDeviceId;
}

export function parseBoundRealtimeCryptoDeviceId(
  envelope: RealtimeEnvelope,
): string | null {
  if (
    envelope.type !== cryptoDeviceBoundEventType ||
    typeof envelope.payload !== "object" ||
    envelope.payload === null
  ) {
    return null;
  }

  const cryptoDeviceId = (envelope.payload as { cryptoDeviceId?: unknown }).cryptoDeviceId;
  if (typeof cryptoDeviceId !== "string" || cryptoDeviceId.trim() === "") {
    return null;
  }

  return cryptoDeviceId;
}
