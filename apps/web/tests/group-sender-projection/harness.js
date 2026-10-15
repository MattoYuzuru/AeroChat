import React, {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useEncryptedGroupLane,CryptoRuntimeContext,gatewayClient,publishEncryptedGroupRealtimeEvent,clearBufferedEncryptedGroupRealtimeEvents,publishLocalEncryptedGroupProjection,clearBufferedLocalEncryptedGroupProjection,listBufferedLocalEncryptedGroupProjection} from 'virtual:group-sender-projection';

// Hook, buffer и projection merge — исходные production modules; только gateway/crypto adapter синтетический.
const projection={status:'ready',messageId:'message-1',groupId:'group-1',threadId:'thread-1',mlsGroupId:'mls-1',rosterVersion:1,senderUserId:'sender-1',senderCryptoDeviceId:'device-1',operationKind:'content',targetMessageId:null,replyToMessageId:null,revision:1,createdAt:'2026-10-12T00:00:00.000Z',serverSequence:'1',storedAt:'2026-10-12T00:00:01.000Z',payloadSchema:'aerochat.web.encrypted_group_message_v1.payload.v1',text:'synthetic group sender body',markdownPolicy:'MARKDOWN_POLICY_SAFE_SUBSET_V1',attachments:[],editedAt:null,deletedAt:null};
const opaque={...projection,ciphertext:'synthetic opaque bytes',ciphertextSizeBytes:22,viewerDelivery:{recipientUserId:'sender-1',recipientCryptoDeviceId:'device-1',storedAt:projection.storedAt,unreadState:null}};
const failure={status:'decrypt_failed',messageId:projection.messageId,groupId:projection.groupId,threadId:projection.threadId,mlsGroupId:projection.mlsGroupId,rosterVersion:projection.rosterVersion,senderUserId:projection.senderUserId,senderCryptoDeviceId:projection.senderCryptoDeviceId,operationKind:'content',targetMessageId:null,revision:1,createdAt:projection.createdAt,serverSequence:'1',storedAt:projection.storedAt,failureKind:'aad_mismatch'};
const snapshot={support:'available',phase:'ready',localDevice:{status:'active',cryptoDeviceId:'device-1'},devices:[],linkIntents:[],currentBundle:null,canCreatePendingDevice:false,canApproveLinkIntents:false,notice:null,errorMessage:null};
const root=createRoot(document.getElementById('root'));
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
let controls,report,bootstrapCalls=0,listCalls=0,decryptCalls=0,resolveServer,providerRenders=0;
gatewayClient.getEncryptedGroupBootstrap=async(_token,groupId,_device)=>{bootstrapCalls++;return {lane:{groupId,threadId:'thread-1',mlsGroupId:'mls-1',rosterVersion:1,activatedAt:'2026-10-12T00:00:00.000Z',updatedAt:'2026-10-12T00:00:00.000Z'},rosterMembers:[],rosterDevices:[]};};
gatewayClient.listEncryptedGroupMessages=async()=>{listCalls++;return [];};
function Probe({groupId,token,enabled,pending,scope}){
 const lane=useEncryptedGroupLane({enabled,token,groupId});
 useEffect(()=>{report={status:lane.status,groupId,pending,scope,bootstrapGroupId:lane.bootstrap?.lane.groupId??null,ready:lane.items.filter(item=>item.kind==='message').map(item=>({messageId:item.messageId,text:item.text,revision:item.revision,serverSequence:item.serverSequence})),failures:lane.items.filter(item=>item.kind==='failure').map(item=>({messageId:item.messageId,failureKind:item.failureKind})),buffered:listBufferedLocalEncryptedGroupProjection('group-1').length,bootstrapCalls,listCalls,decryptCalls,providerRenders};});
 return React.createElement('div',{'data-status':lane.status},lane.items.map(item=>React.createElement('article',{key:item.key},item.kind==='message'?item.text:item.failureKind)));
}
function App(){
 const [pending,setPending]=useState(false),[scope,setScope]=useState('initial');
 const groupId=scope==='group-change'?'group-2':'group-1',token=scope==='token-change'?'synthetic replacement session':'synthetic fixture session',enabled=scope!=='disabled';
 controls={setPending,setScope};providerRenders++;
 // Новый context value и method identity при каждой смене action state повторяют настоящий Provider.
 const value={state:{status:'ready',snapshot:{...snapshot,localDevice:{...snapshot.localDevice,cryptoDeviceId:scope==='device-change'?'device-2':'device-1',status:scope==='retired-device'?'revoked':'active'}},isActionPending:pending,pendingLabel:pending?'synthetic send in progress':null},decryptEncryptedGroupEnvelopes(envelopes){
  if(envelopes.length===0)return Promise.resolve([]);
  decryptCalls++;return new Promise(resolve=>{resolveServer=resolve;});
 }};
 return React.createElement(CryptoRuntimeContext.Provider,{value},React.createElement(Probe,{groupId,token,enabled,pending,scope}));
}
window.fixture={
 mount(){clearBufferedEncryptedGroupRealtimeEvents();clearBufferedLocalEncryptedGroupProjection();root.render(React.createElement(App));},
 report(){return report?{...report,bootstrapCalls,listCalls,decryptCalls,providerRenders,buffered:listBufferedLocalEncryptedGroupProjection('group-1').length}:null;},
 startServerCopy(){publishEncryptedGroupRealtimeEvent({type:'encrypted_group_message_v1.delivery',envelope:opaque});},
 async finishSendState(){controls.setPending(true);await paint();controls.setPending(false);await paint();},
 publishStoredSendResult(){publishLocalEncryptedGroupProjection(projection);},
 async changeScope(kind){if(kind==='token-change')clearBufferedEncryptedGroupRealtimeEvents();controls.setScope(kind);await paint();},
 resolveServerCopy(kind){if(!resolveServer)throw new Error('Expected deferred production decrypt call');resolveServer([kind==='failure'?failure:projection]);},
 async unmount(){root.unmount();await paint();},
};
