import type { CryptoContextState } from "./runtime-context";
import type { RealtimeClientEnvelope } from "../realtime/client";

const bindCryptoDeviceEventType = "connection.bind_crypto_device";

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
