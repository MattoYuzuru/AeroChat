export const call = { id: 'call-1', scope: {kind: 'direct', directChatId: 'chat-1'}, createdByUserId: 'creator', status: 'active' };
export const participants = [{ id: 'p-1', userId: 'creator', state: 'active', callId: call.id }, { id: 'p-2', userId: 'joiner', state: 'active', callId: call.id }];
export const log = [];
export const gatewayClient = {
  getRtcIceServers: async () => [],
  startCall: async () => { log.push('start'); return {call, selfParticipant:participants[0]}; },
  joinCall: async () => { log.push('join'); return {call, selfParticipant:participants[0]}; },
  sendRtcSignal: async () => {},
  touchCallParticipant: async () => { log.push('heartbeat'); },
  leaveCall: async () => { log.push('leave'); },
  endCall: async () => { log.push('end'); },
};
