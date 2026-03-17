import type { RealtimeEnvelope } from "./client";

type RealtimeEnvelopeListener = (event: RealtimeEnvelope) => void;

const listeners = new Set<RealtimeEnvelopeListener>();

export function publishRealtimeEnvelope(event: RealtimeEnvelope) {
  listeners.forEach((listener) => {
    listener(event);
  });
}

export function subscribeRealtimeEnvelopes(listener: RealtimeEnvelopeListener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
