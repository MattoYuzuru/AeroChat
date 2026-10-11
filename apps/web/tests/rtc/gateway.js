export const call = { id: 'call-1', scope: {kind: 'direct', directChatId: 'chat-1'}, createdByUserId: 'creator', status: 'active' };
export const participants = [{ id: 'p-1', userId: 'creator', state: 'active', callId: call.id }, { id: 'p-2', userId: 'joiner', state: 'active', callId: call.id }];
export const log = [];
export const gatewayState = {configurationPending:false};
let releaseMutation;
let deferred = false;
let releaseConfiguration;
let configurationDeferred = false;
let releaseLeave;
let leaveDeferred = false;
let leaveFails = false;
export function deferMutation() { deferred = true; }
export function finishMutation() { releaseMutation(); }
export function deferConfiguration(){configurationDeferred=true;}
export function finishConfiguration(){releaseConfiguration();}
export function deferLeave(){leaveDeferred=true;}
export function finishLeave(){releaseLeave();}
export function failLeave(value){leaveFails=value;}
async function mutation(method,token) {
  log.push(method);
  if (deferred) {deferred=false;await new Promise(resolve => { releaseMutation = resolve; });}
  return {call, selfParticipant:participants[token==='synthetic-joiner'?1:0]};
}
export const gatewayClient = {
  getRtcIceServers: async () => {if(configurationDeferred){configurationDeferred=false;gatewayState.configurationPending=true;await new Promise(resolve=>{releaseConfiguration=resolve;});gatewayState.configurationPending=false;}return [];},
  startCall: token => mutation('start',token),
  joinCall: token => mutation('join',token),
  sendRtcSignal: async () => {},
  touchCallParticipant: async () => { log.push('heartbeat'); },
  leaveCall: async () => { log.push('leave');if(leaveDeferred){leaveDeferred=false;await new Promise(resolve=>{releaseLeave=resolve;});}if(leaveFails)throw new Error('leave unavailable'); },
  endCall: async () => { log.push('end'); },
};
