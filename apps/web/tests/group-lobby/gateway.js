export const touches=[];
export const gatewayClient={touchCallParticipant:async(token,callId)=>{touches.push({token,callId});}};
