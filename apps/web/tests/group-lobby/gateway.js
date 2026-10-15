export const touches=[];
let resolveMutation;
let deferred = false;
export const mutations=[];
export const deferMutation=()=>{deferred=true;};
export const finishMutation=()=>{resolveMutation();resolveMutation=null;};
const mutation=async(type)=>{
  mutations.push(type);
  if(deferred){deferred=false;await new Promise(resolve=>{resolveMutation=resolve;});}
  return {call:{id:'call-1'},selfParticipant:{userId:'user-1'}};
};
export const gatewayClient={
  touchCallParticipant:async(token,callId)=>{touches.push({token,callId});},
  startCall:()=>mutation('start'),joinCall:()=>mutation('join'),
  leaveCall:async()=>{mutations.push('leave');},endCall:async()=>{mutations.push('end');},
};
