import { useEffect, useRef } from "react";
import { useCryptoRuntime } from "./useCryptoRuntime";
import {
  buildBindCryptoDeviceRealtimeEnvelope,
  resolveActiveRealtimeCryptoDeviceId,
} from "./realtime-bridge-helpers";
import { subscribeRealtimeEnvelopes } from "../realtime/events";
import {
  sendRealtimeClientEnvelope,
  type RealtimeEnvelope,
} from "../realtime/client";
import {
  parseEncryptedDirectMessageV2RealtimeEvent,
  publishEncryptedDirectMessageV2RealtimeEvent,
} from "../chats/encrypted-v2-realtime";
import {
  parseEncryptedGroupRealtimeEvent,
  publishEncryptedGroupRealtimeEvent,
} from "../groups/encrypted-group-realtime";

const readyEventType = "connection.ready";

export function CryptoRealtimeBridge() {
  const cryptoRuntime = useCryptoRuntime();
  const activeCryptoDeviceId = resolveActiveRealtimeCryptoDeviceId(cryptoRuntime.state);
  const activeCryptoDeviceIdRef = useRef<string | null>(activeCryptoDeviceId);

  useEffect(() => {
    activeCryptoDeviceIdRef.current = activeCryptoDeviceId;
    if (activeCryptoDeviceId === null) {
      return;
    }

    sendRealtimeClientEnvelope(buildBindCryptoDeviceRealtimeEnvelope(activeCryptoDeviceId));
  }, [activeCryptoDeviceId]);

  useEffect(() => {
    return subscribeRealtimeEnvelopes((envelope: RealtimeEnvelope) => {
      if (envelope.type === readyEventType) {
        const currentCryptoDeviceId = activeCryptoDeviceIdRef.current;
        if (currentCryptoDeviceId !== null) {
          sendRealtimeClientEnvelope(
            buildBindCryptoDeviceRealtimeEnvelope(currentCryptoDeviceId),
          );
        }
        return;
      }

      const encryptedEvent = parseEncryptedDirectMessageV2RealtimeEvent(envelope);
      if (encryptedEvent !== null) {
        publishEncryptedDirectMessageV2RealtimeEvent(encryptedEvent);
        return;
      }

      const encryptedGroupEvent = parseEncryptedGroupRealtimeEvent(envelope);
      if (encryptedGroupEvent !== null) {
        publishEncryptedGroupRealtimeEvent(encryptedGroupEvent);
      }
    });
  }, []);

  return null;
}
