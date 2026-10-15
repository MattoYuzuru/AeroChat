import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CryptoRuntimeContext} from '../../src/crypto/runtime-context';
import {useEncryptedDirectMessageV2Lane} from '../../src/chats/useEncryptedDirectMessageV2Lane';
import {useEncryptedGroupLane} from '../../src/groups/useEncryptedGroupLane';
import {publishEncryptedDirectMessageV2RealtimeEvent,clearBufferedEncryptedDirectMessageV2RealtimeEvents} from '../../src/chats/encrypted-v2-realtime';
import {publishEncryptedGroupRealtimeEvent,clearBufferedEncryptedGroupRealtimeEvents} from '../../src/groups/encrypted-group-realtime';
import {publishRealtimeEnvelope} from '../../src/realtime/events';
const lane = new URL(location.href).searchParams.get('lane');
let root,report,scopeSetter,history=[],calls=[],pending=[],hold=false;
function projection(id,seq,kind='content',target=null,scope='scope-a') {
 return {status:'ready',messageId:id,serverSequence:seq,operationKind:kind,targetMessageId:target,
 chatId:scope,groupId:scope,threadId:'thread',mlsGroupId:'mls',rosterVersion:1,
 senderUserId:'sender',senderCryptoDeviceId:'sender-device',revision:kind==='content'?1:2,
 createdAt:'2026-10-11T10:00:00Z',storedAt:'2026-10-11T10:00:00Z',replyToMessageId:null,
 payloadSchema:lane==='direct'?'aerochat.web.encrypted_direct_message_v2.payload.v1':'aerochat.web.encrypted_group_message_v1.payload.v1',
 text:kind==='tombstone'?null:id,markdownPolicy:'MARKDOWN_POLICY_SAFE_SUBSET_V1',attachments:[],
 editedAt:kind==='edit'?'2026-10-11T10:00:00Z':null,deletedAt:kind==='tombstone'?'2026-10-11T10:00:00Z':null};
}
function opaque(value){return {...value,viewerDelivery:{recipientCryptoDeviceId:'viewer',recipientUserId:'user',storedAt:value.storedAt},ciphertext:'synthetic'};}
function decrypt(envelopes){
 calls.push(envelopes.map(value=>value.messageId));
 if(!hold)return Promise.resolve(envelopes.map(value=>({...value,status:'ready'})));
 return new Promise(resolve=>pending.push({ids:envelopes.map(value=>value.messageId),resolve:()=>resolve(envelopes.map(value=>({...value,status:'ready'})))}));
}
const runtime={state:{status:'ready',snapshot:{support:'available',phase:'ready',localDevice:{status:'active',cryptoDeviceId:'viewer'}}},decryptEncryptedDirectMessageV2Envelopes:decrypt,decryptEncryptedGroupEnvelopes:decrypt};
function View(){const [scope,setScope]=useState('scope-a');scopeSetter=setScope;
 const result = lane==='direct' ? useEncryptedDirectMessageV2Lane({enabled:true,token:'fixture',chatId:scope}) : useEncryptedGroupLane({enabled:true,token:'fixture',groupId:scope});
 report={...result,scope};return React.createElement('pre',null,JSON.stringify(report));}
window.fixture={
 mount(){root=createRoot(document.getElementById('root'));root.render(React.createElement(CryptoRuntimeContext.Provider,{value:runtime},React.createElement(View)));},
 unmount(){root.unmount();clearBufferedEncryptedDirectMessageV2RealtimeEvents();clearBufferedEncryptedGroupRealtimeEvents();},
 report(){return {state:report,calls,pending:pending.map(item=>item.ids)};},history(){return history;},
 clearBuffer(){clearBufferedEncryptedDirectMessageV2RealtimeEvents();clearBufferedEncryptedGroupRealtimeEvents();},
 hold(){hold=true;},setHistory(values){history=values.map(value=>opaque(projection(...value)));},
 send(id,seq,kind='content',target=null,scope='scope-a'){
  const event={type:lane==='direct'?'encrypted_direct_message_v2.delivery':'encrypted_group_message_v1.delivery',envelope:opaque(projection(id,seq,kind,target,scope))};
  if(lane==='direct')publishEncryptedDirectMessageV2RealtimeEvent(event);else publishEncryptedGroupRealtimeEvent(event);
 },
 release(id){const index=pending.findIndex(item=>item.ids.length===1&&item.ids[0]===id);if(index<0)throw new Error('missing decrypt '+id);pending.splice(index,1)[0].resolve();},
 releaseLoad(){const index=pending.findIndex(item=>item.ids.length!==1||item.ids[0]==='origin');if(index<0)throw new Error('missing load');pending.splice(index,1)[0].resolve();},
 switchScope(scope){scopeSetter(scope);},reconnect(){publishRealtimeEnvelope({type:'connection.crypto_device.bound',payload:{cryptoDeviceId:'viewer'}});},
};
