export const calls = new Map();
export const log = [];
export const order = [];
let mutationDelay, configurationDelay, leaveDelay, mutationRelease, configurationRelease, leaveRelease;
let failMutation = false;
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;});return {promise, resolve};};
export const controls = {
  deferMutation(){mutationDelay=deferred();mutationRelease=mutationDelay.resolve;},
  finishMutation(){mutationRelease();},
  deferConfiguration(){configurationDelay=deferred();configurationRelease=configurationDelay.resolve;},
  finishConfiguration(){configurationRelease();},
  deferLeave(){leaveDelay=deferred();leaveRelease=leaveDelay.resolve;},
  finishLeave(){leaveRelease();},
  failMutation(value){failMutation=value;},
  peerPresent(chatId,present){const entry=calls.get(chatId);entry.participants=present?[entry.self,{id:'peer-participant',userId:'peer',state:'active',callId:entry.call.id}]:[entry.self];},
};
const user = token => token.includes('account-b') ? 'account-b' : 'creator';
async function mutation(method, token, chatId) {
  log.push({method,chatId});order.push("rpc:"+method);
  if(mutationDelay){const pending=mutationDelay;mutationDelay=null;await pending.promise;}
  if(failMutation)throw new Error('owned synthetic mutation failure');
  let entry=calls.get(chatId);
  if(!entry){const call={id:chatId+'-call',scope:{kind:'direct',directChatId:chatId},createdByUserId:user(token),status:'active'};
    const self={id:chatId+'-self',userId:user(token),state:'active',callId:call.id};entry={call,self,participants:[self,{id:chatId+'-peer',userId:'peer',state:'active',callId:call.id}]};calls.set(chatId,entry);}
  return {call:entry.call,selfParticipant:entry.self};
}
export const gatewayClient = {
  async getRtcIceServers(){if(configurationDelay){const pending=configurationDelay;configurationDelay=null;log.push({method:'configuration-pending'});await pending.promise;}return [];},
  startCall:(token,scope)=>mutation('start',token,scope.directChatId),
  joinCall:(token,callId)=>mutation('join',token,[...calls.values()].find(entry=>entry.call.id===callId).call.scope.directChatId),
  sendRtcSignal:async()=>{},
  touchCallParticipant:async()=>{},
  async leaveCall(_token,callId){log.push({method:'leave',callId});order.push('rpc:leave');if(leaveDelay){const pending=leaveDelay;leaveDelay=null;await pending.promise;}},
  async endCall(_token,callId){log.push({method:'end',callId});order.push('rpc:end');},
};
