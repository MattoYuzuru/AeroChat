import React, {useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {useDirectCallSession} from '../../src/rtc/useDirectCallSession';
import {DirectCallMicrophoneButton} from '../../src/rtc/DirectCallMicrophoneButton';
import {createDirectCallJoinCoordinator} from '../../src/rtc/join-coordinator';
import {createLocalCallCaptureOwner} from '../../src/rtc/local-call-capture-owner';
import {createInitialDirectCallAwarenessState,directCallAwarenessReducer,selectDirectCallAwarenessEntry} from '../../src/rtc/awareness';
import {calls,log,order,controls} from './owner-gateway.js';

const owner=createLocalCallCaptureOwner(),joinCoordinator=createDirectCallJoinCoordinator(),initialAuthEpoch=Symbol();
const roots=new Map(),options=new Map(),sessions=new Map(),tracks=[],peers=[],peerEvents=[];
let captureCount=0,nextCaptureDeferred=false,capturePending;
let awareness=createInitialDirectCallAwarenessState(),providerVersion=0,callbackId=0,commitSequence=0;
const committed=new Map(),commitWaiters=new Set(),refreshes=[],epochIds=new Map();
const epochId=epoch=>{if(!epochIds.has(epoch))epochIds.set(epoch,epochIds.size+1);return epochIds.get(epoch);};
function waitForCommit(id,version,status){
  const prior=committed.get(id);
  if(!roots.has(id))return Promise.resolve(null);
  if(prior?.version>=version&&prior.status===status)return Promise.resolve(prior);
  return new Promise(resolve=>commitWaiters.add({id,version,status,resolve}));
}
function notifyCommit(id,version,status){
  const actual={version,status,sequence:++commitSequence};committed.set(id,actual);
  for(const waiter of commitWaiters)if(waiter.id===id&&actual.version>=waiter.version&&actual.status===waiter.status){commitWaiters.delete(waiter);waiter.resolve(actual);}
}
function dispatchAwareness(action){awareness=directCallAwarenessReducer(awareness,action);providerVersion++;for(const id of roots.keys())render(id);return providerVersion;}
function contextIdentity(id){const opts=options.get(id);return {userId:opts.currentUserId,scopeId:opts.chat.id,epochId:epochId(opts.captureAuthEpoch)};}
function captureRefresh(id,captured){
  const identity={callbackId:++callbackId,userId:captured.currentUserId,scopeId:captured.chat.id,epochId:epochId(captured.captureAuthEpoch)};
  return async(showLoading=false)=>{
    const current=options.get(id);
    const record={...identity,tokenMatchesCurrent:captured.token===current.token,userMatchesCurrent:captured.currentUserId===current.currentUserId,scopeMatchesCurrent:captured.chat.id===current.chat.id,epochMatchesCurrent:captured.captureAuthEpoch===current.captureAuthEpoch,showLoading};
    refreshes.push(record);
    if(showLoading){const version=dispatchAwareness({type:'full_sync_started'});record.loadingCommit=await waitForCommit(id,version,'loading');}
    // Settlement идёт после actual React loading commit, а не таймера или mutable options.
    await Promise.resolve();
    const entry=calls.get(captured.chat.id);
    const version=dispatchAwareness({type:'chat_sync_succeeded',chat:captured.chat,chatId:captured.chat.id,call:entry?.call??null,participants:entry?[...entry.participants]:[]});
    record.readyCommit=await waitForCommit(id,version,'ready');
  };
}
const createStream=(id,count=1)=>{
  const own=Array.from({length:count},(_,index)=>({id:id+'-'+index,kind:'audio',enabled:true,readyState:'live',contentHint:'',
    stop(){if(this.readyState!=='ended'){this.readyState='ended';order.push('stop:'+this.id);}}}));tracks.push(...own);
  return {id,getTracks:()=>own,getAudioTracks:()=>own};
};
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getSupportedConstraints:()=>({}),getUserMedia:async()=>{
  const id='capture-'+(++captureCount);order.push('capture:'+id);
  if(nextCaptureDeferred){nextCaptureDeferred=false;return new Promise((resolve,reject)=>{capturePending={resolve:count=>resolve(createStream(id,count)),reject};});}
  return createStream(id);
}}});
class Peer extends EventTarget{
  connectionState='new';iceConnectionState='new';signalingState='stable';remoteDescription=null;
  constructor(){super();this.id='peer-'+(peers.length+1);this.captureIds=new Set();this.closed=false;peers.push(this);}
  addTrack(track){this.captureIds.add(track.id);return {track,getParameters:()=>({encodings:[{}]}),setParameters:async()=>{}};}
  close(){this.closed=true;this.connectionState='closed';this.signalingState='closed';order.push('peer-close:'+this.id);}
  async createOffer(){return {type:'offer',sdp:'owned-synthetic-offer'};}
  async createAnswer(){return {type:'answer',sdp:'owned-synthetic-answer'};}
  async setLocalDescription(description){this.signalingState=description.type==='offer'?'have-local-offer':'stable';}
  async setRemoteDescription(description){this.remoteDescription=description;this.signalingState='stable';}
  async addIceCandidate(){}
}
window.RTCPeerConnection=Peer;
function render(id){
  const input=options.get(id),captured=Object.freeze({...input,chat:Object.freeze({...input.chat})});
  const hookOptions={...captured,awarenessEntry:selectDirectCallAwarenessEntry(awareness,captured.chat.id),awarenessSyncStatus:awareness.syncStatus,refreshDirectChatCall:captureRefresh(id,captured)};
  const props={id,hookOptions,version:providerVersion,providerStatus:awareness.syncStatus};
  roots.get(id).render(input.strict?React.createElement(React.StrictMode,null,React.createElement(Harness,props)):React.createElement(Harness,props));
}
function refresh(id){const captured=Object.freeze({...options.get(id),chat:Object.freeze({...options.get(id).chat})});return captureRefresh(id,captured)();}
function Harness({id,hookOptions,version,providerStatus}){
  const session=useDirectCallSession(hookOptions);
  useLayoutEffect(()=>{sessions.set(id,session);notifyCommit(id,version,providerStatus);return()=>{if(sessions.get(id)===session)sessions.delete(id);};},[id,session,version,providerStatus]);
  return <section data-window={id} data-ready={session.state.syncStatus} data-provider-sync={providerStatus}>
    <button disabled={!session.canStart} onClick={()=>void session.startCall()}>Начать звонок</button>
    <button disabled={!session.canJoin} onClick={()=>void session.joinCall()}>Присоединиться</button>
    <DirectCallMicrophoneButton session={session}/>
    {session.state.errorMessage&&<p role="alert">{session.state.errorMessage}</p>}
  </section>;
}
window.fixture={
  mount(id='a',strict=false){options.set(id,{joinCoordinator,localCaptureOwner:owner,captureAuthEpoch:initialAuthEpoch,enabled:true,token:'synthetic-creator',chat:{id:'chat-'+id,kind:'direct'},currentUserId:'creator',awarenessEntry:null,awarenessSyncStatus:'ready',pageVisible:true,strict,refreshDirectChatCall:async()=>refresh(id),onUnauthenticated:()=>{}});roots.set(id,createRoot(document.getElementById(id)));render(id);},
  unmount(id='a'){roots.get(id).unmount();roots.delete(id);committed.delete(id);for(const waiter of commitWaiters)if(waiter.id===id){commitWaiters.delete(waiter);waiter.resolve(null);}},
  start:(id='a')=>sessions.get(id).startCall(),join:(id='a')=>sessions.get(id).joinCall(),
  leave:(id='a')=>sessions.get(id).leaveCall(),end:(id='a')=>sessions.get(id).endCall(),
  toggle:(id='a')=>sessions.get(id).toggleMicrophone(),dismiss:(id='a')=>sessions.get(id).dismissError(),
  boundary(kind,id='a'){const start=refreshes.length,opts=options.get(id);if(kind==='token')opts.token='synthetic-renewed';if(kind==='account'){opts.currentUserId='account-b';opts.token='synthetic-account-b';}if(kind==='token'||kind==='account')opts.captureAuthEpoch=Symbol();if(kind==='scope')opts.chat={id:'chat-new',kind:'direct'};if(kind==='disabled')opts.enabled=false;render(id);return {start,...contextIdentity(id)};},
  minimize(id='a',hidden=true){document.getElementById(id).hidden=hidden;},
  peer(present,id='a'){controls.peerPresent(options.get(id).chat.id,present);refresh(id);},
  endCapture(){for(const track of tracks.filter(track=>track.readyState==='live')){track.readyState='ended';track.onended?.();}},
  connectPeer(id){const peer=peers.find(item=>item.id===id);peer.remoteDescription={type:'answer',sdp:'owned-synthetic-answer'};peer.signalingState='stable';peer.connectionState='connected';peerEvents.push({id,type:'connectionstatechange'});peer.dispatchEvent(new Event('connectionstatechange'));},
  deferCapture(){nextCaptureDeferred=true;},releaseCapture(count=1){capturePending.resolve(count);},rejectCapture(){capturePending.reject(new DOMException('owned denied capture','NotAllowedError'));},
  ...controls,
  reserveGroup(){const result=owner.acquire({kind:'group',userId:'group-user',authEpoch:Symbol(),scopeId:'group-fixture',generation:1});window.groupLease=result.lease;result.lease?.retain();result.lease?.settle();},
  closeGroup(){window.groupLease.close();},releaseGroup(){window.groupLease.release();},
  report(){const active=peers.filter(peer=>!peer.closed&&[...peer.captureIds].some(id=>tracks.some(track=>track.id===id&&track.readyState==='live')));const describePeer=peer=>({id:peer.id,closed:peer.closed,connectionState:peer.connectionState,captureIds:[...peer.captureIds]});return {currentPeer:active.length===1?describePeer(active[0]):null,activePeers:active.map(describePeer),peerRecords:peers.map(describePeer),peerEvents:[...peerEvents],refreshes:refreshes.map(record=>({...record})),contexts:Object.fromEntries([...options.keys()].map(id=>[id,contextIdentity(id)])),slot:owner.getSnapshot(),captures:captureCount,tracks:tracks.map(({id,enabled,readyState})=>({id,enabled,readyState})),liveTracks:tracks.filter(track=>track.readyState==='live').length,peers:peers.length,peerStates:peers.map(peer=>peer.connectionState),log:[...log],order:[...order],sessions:Object.fromEntries([...sessions].map(([id,s])=>[id,{state:s.state,canStart:s.canStart,canJoin:s.canJoin,canToggleMicrophone:s.canToggleMicrophone,isMicrophoneMuted:s.isMicrophoneMuted}]))};},
};
