export const listeners = new Set();
export const subscribeRealtimeEnvelopes = listener => {listeners.add(listener);return ()=>listeners.delete(listener);};
export const subscribeRealtimeLifecycleEvents = () => () => {};
