import type { RealtimeEnvelope } from "./client";

type RealtimeEnvelopeListener = (event: RealtimeEnvelope) => void;
type RealtimeLifecycleListener = (event: RealtimeLifecycleEvent) => void;

export interface RealtimeLifecycleEvent {
  type: "realtime.connected" | "realtime.disconnected";
}

const listeners = new Set<RealtimeEnvelopeListener>();
const lifecycleListeners = new Set<RealtimeLifecycleListener>();

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

export function publishRealtimeLifecycleEvent(event: RealtimeLifecycleEvent) {
  lifecycleListeners.forEach((listener) => {
    listener(event);
  });
}

export function subscribeRealtimeLifecycleEvents(listener: RealtimeLifecycleListener) {
  lifecycleListeners.add(listener);

  return () => {
    lifecycleListeners.delete(listener);
  };
}
