export const call = { id: 'call-1', scope: {kind: 'direct', directChatId: 'chat-1'}, createdByUserId: 'creator', status: 'active' };
export const participants = [{ id: 'p-1', userId: 'creator', state: 'active', callId: call.id }, { id: 'p-2', userId: 'joiner', state: 'active', callId: call.id }];
export const log = [];
let releaseMutation;
let deferred = false;
export function deferMutation() { deferred = true; }
export function finishMutation() { releaseMutation(); }
async function mutation(method) {
  log.push(method);
  if (deferred) await new Promise(resolve => { releaseMutation = resolve; });
  return {call, selfParticipant:participants[0]};
}
export const gatewayClient = {
  getRtcIceServers: async () => [],
  startCall: () => mutation('start'),
  joinCall: () => mutation('join'),
  sendRtcSignal: async () => {},
  touchCallParticipant: async () => { log.push('heartbeat'); },
  leaveCall: async () => { log.push('leave'); },
  endCall: async () => { log.push('end'); },
};
