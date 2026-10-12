import React, {useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {useDirectCallSession} from '../../src/rtc/useDirectCallSession';
import {DirectCallMicrophoneButton} from '../../src/rtc/DirectCallMicrophoneButton';
import {createDirectCallJoinCoordinator} from '../../src/rtc/join-coordinator';
import {createLocalCallCaptureOwner} from '../../src/rtc/local-call-capture-owner';
import {calls,log,order,controls} from './owner-gateway.js';

const owner=createLocalCallCaptureOwner(),joinCoordinator=createDirectCallJoinCoordinator(),initialAuthEpoch=Symbol();
const roots=new Map(),options=new Map(),sessions=new Map(),tracks=[],peers=[];
let captureCount=0,nextCaptureDeferred=false,capturePending;
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
  constructor(){super();peers.push(this);}
  addTrack(track){return {track,getParameters:()=>({encodings:[{}]}),setParameters:async()=>{}};}
  close(){this.connectionState='closed';this.signalingState='closed';}
  async createOffer(){return {type:'offer',sdp:'owned-synthetic-offer'};}
  async createAnswer(){return {type:'answer',sdp:'owned-synthetic-answer'};}
  async setLocalDescription(description){this.signalingState=description.type==='offer'?'have-local-offer':'stable';}
  async setRemoteDescription(description){this.remoteDescription=description;this.signalingState='stable';}
  async addIceCandidate(){}
}
window.RTCPeerConnection=Peer;
function render(id){const props={id};roots.get(id).render(options.get(id).strict?React.createElement(React.StrictMode,null,React.createElement(Harness,props)):React.createElement(Harness,props));}
function refresh(id){const opts=options.get(id),entry=calls.get(opts.chat.id);opts.awarenessEntry=entry?{call:entry.call,participants:[...entry.participants],syncStatus:'ready',errorMessage:null}:null;if(roots.has(id))render(id);}
function Harness({id}){
  const session=useDirectCallSession(options.get(id));
  useLayoutEffect(()=>{sessions.set(id,session);return()=>{if(sessions.get(id)===session)sessions.delete(id);};},[id,session]);
  return <section data-window={id} data-ready={session.state.syncStatus}>
    <button disabled={!session.canStart} onClick={()=>void session.startCall()}>Начать звонок</button>
    <button disabled={!session.canJoin} onClick={()=>void session.joinCall()}>Присоединиться</button>
    <DirectCallMicrophoneButton session={session}/>
    {session.state.errorMessage&&<p role="alert">{session.state.errorMessage}</p>}
  </section>;
}
window.fixture={
  mount(id='a',strict=false){options.set(id,{joinCoordinator,localCaptureOwner:owner,captureAuthEpoch:initialAuthEpoch,enabled:true,token:'synthetic-creator',chat:{id:'chat-'+id,kind:'direct'},currentUserId:'creator',awarenessEntry:null,awarenessSyncStatus:'ready',pageVisible:true,strict,refreshDirectChatCall:async()=>refresh(id),onUnauthenticated:()=>{}});roots.set(id,createRoot(document.getElementById(id)));render(id);},
  unmount(id='a'){roots.get(id).unmount();roots.delete(id);},
  start:(id='a')=>sessions.get(id).startCall(),join:(id='a')=>sessions.get(id).joinCall(),
  leave:(id='a')=>sessions.get(id).leaveCall(),end:(id='a')=>sessions.get(id).endCall(),
  toggle:(id='a')=>sessions.get(id).toggleMicrophone(),dismiss:(id='a')=>sessions.get(id).dismissError(),
  boundary(kind,id='a'){const opts=options.get(id);if(kind==='token')opts.token='synthetic-renewed';if(kind==='account'){opts.currentUserId='account-b';opts.token='synthetic-account-b';}if(kind==='token'||kind==='account')opts.captureAuthEpoch=Symbol();if(kind==='scope'){opts.chat={id:'chat-new',kind:'direct'};opts.awarenessEntry=null;}if(kind==='disabled')opts.enabled=false;render(id);},
  minimize(id='a',hidden=true){document.getElementById(id).hidden=hidden;},
  peer(present,id='a'){controls.peerPresent(options.get(id).chat.id,present);refresh(id);},
  endCapture(){for(const track of tracks.filter(track=>track.readyState==='live')){track.readyState='ended';track.onended?.();}},
  deferCapture(){nextCaptureDeferred=true;},releaseCapture(count=1){capturePending.resolve(count);},rejectCapture(){capturePending.reject(new DOMException('owned denied capture','NotAllowedError'));},
  ...controls,
  reserveGroup(){const result=owner.acquire({kind:'group',userId:'group-user',authEpoch:Symbol(),scopeId:'group-fixture',generation:1});window.groupLease=result.lease;result.lease?.retain();result.lease?.settle();},
  closeGroup(){window.groupLease.close();},releaseGroup(){window.groupLease.release();},
  report(){return {slot:owner.getSnapshot(),captures:captureCount,tracks:tracks.map(({id,enabled,readyState})=>({id,enabled,readyState})),liveTracks:tracks.filter(track=>track.readyState==='live').length,peers:peers.length,peerStates:peers.map(peer=>peer.connectionState),log:[...log],order:[...order],sessions:Object.fromEntries([...sessions].map(([id,s])=>[id,{state:s.state,canStart:s.canStart,canJoin:s.canJoin,canToggleMicrophone:s.canToggleMicrophone,isMicrophoneMuted:s.isMicrophoneMuted}]))};},
};
