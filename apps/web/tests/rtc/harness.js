import React from 'react';
import {createRoot} from 'react-dom/client';
import {useDirectCallSession} from '../../src/rtc/useDirectCallSession';
import {DirectCallMicrophoneButton} from '../../src/rtc/DirectCallMicrophoneButton';
import {createDirectCallJoinCoordinator} from '../../src/rtc/join-coordinator';
import {usePlayback} from 'virtual:playback';
import {listeners} from './realtime.js';
import {call, participants, log, gatewayState, deferMutation, finishMutation, deferConfiguration, finishConfiguration, deferLeave, finishLeave, failLeave, nextCall} from './gateway.js';

const observations = { stops: 0, captures: 0, plays: 0, pauses: 0, peers: [] };
const candidates = [];
let candidateDeferred = false;
let candidatePending = false;
let finishCandidate;
let blocked = false;
let deferPlayback = false;
let completePlayback;
const audio = {srcObject: null, pause(){observations.pauses++;}, play(){observations.plays++;if(deferPlayback){deferPlayback=false;return new Promise((resolve,reject)=>{completePlayback=rejectResult=>rejectResult?reject(new Error('blocked')):resolve();});}if(observations.plays>3)return new Promise(()=>{});return blocked ? Promise.reject(new Error('blocked')) : Promise.resolve();}};
const track = {stop:()=>observations.stops++, contentHint:'', kind:'audio', enabled:true, readyState:'live'};
const stream = () => ({getTracks:()=>[track], getAudioTracks:()=>[track]});
const capturedStream = () => ({getTracks:()=>[track,{...track}],getAudioTracks:()=>[track]});
let captureDeferred = false;
let releaseCapture;
let rejectCapture;
Object.defineProperty(navigator, 'mediaDevices', {configurable:true, value:{getSupportedConstraints:()=>({}), getUserMedia:async()=>{
  observations.captures++;
  if (captureDeferred) {captureDeferred=false;return new Promise((resolve,reject)=>{releaseCapture=()=>resolve(capturedStream());rejectCapture=reject;});}
  return stream();
}}});
class FakePeer extends EventTarget {
  connectionState = 'new'; iceConnectionState = 'new'; signalingState = 'stable'; remoteDescription = null;
  constructor(){super();observations.peers.push(this);}
  addTrack(){return {getParameters:()=>({encodings:[{}]}), setParameters:async()=>{}, track};}
  close(){this.connectionState='closed'; this.signalingState='closed';}
  async createOffer(){return {type:'offer',sdp:'fixture-offer'};}
  async createAnswer(){return {type:'answer',sdp:'fixture-answer'};}
  async setLocalDescription(desc){this.signalingState=desc.type==='offer'?'have-local-offer':'stable';}
  async setRemoteDescription(desc){this.remoteDescription=desc; this.signalingState='stable';}
  async addIceCandidate(candidate){candidates.push({peer:observations.peers.indexOf(this),candidate:candidate.candidate});if(candidateDeferred){candidateDeferred=false;candidatePending=true;await new Promise(resolve=>{finishCandidate=resolve;});candidatePending=false;}}
  emitState(value){this.connectionState=value;this.dispatchEvent(new Event('connectionstatechange'));}
}
window.RTCPeerConnection = FakePeer;
let session;
let root;
const opts = {joinCoordinator:createDirectCallJoinCoordinator(),enabled:true, token:'synthetic', chat:{id:'chat-1',kind:'direct'}, awarenessEntry:null, awarenessSyncStatus:'ready', currentUserId:'creator', pageVisible:true, refreshDirectChatCall:async()=>{}, onUnauthenticated:()=>{}};
function Harness(){
  session=useDirectCallSession(opts);
  usePlayback({directCallAudioRef:{current:audio}, directCallRemoteAudioStream:session.remoteAudioStream, retryDirectCallRemoteAudioPlayback:session.retryRemoteAudioPlayback});
  return React.createElement(React.Fragment,null,React.createElement('pre',null,JSON.stringify(session.state)),React.createElement(DirectCallMicrophoneButton,{session}));
}
window.fixture = {
  mount(){root=createRoot(document.getElementById('root'));root.render(React.createElement(Harness));},
  start(){return session.startCall();},
  join(){return session.joinCall();},
  leave(){return session.leaveCall();},
  end(){return session.endCall();},
  toggleMicrophone(){session.toggleMicrophone();},
  endCapture(){track.readyState='ended';track.onended?.();},
  changeToken(){opts.token='synthetic-renewed';root.render(React.createElement(Harness));},
  refreshAccount(){opts.currentUserId='joiner';opts.token='synthetic-joiner';opts.awarenessEntry=null;root.render(React.createElement(Harness));},
  changeAccountOnly(){opts.currentUserId='joiner';opts.awarenessEntry=null;root.render(React.createElement(Harness));},
  deferCapture(){captureDeferred=true;},
  releaseCapture(){releaseCapture();},
  rejectCapture(){rejectCapture(new DOMException('denied','NotAllowedError'));},
  deferMutation,
  finishMutation,
  deferConfiguration,
  finishConfiguration,
  nextCall,
  deferCandidate(){candidateDeferred=true;},
  finishCandidate(){finishCandidate();},
  connect(){const peer=observations.peers.at(-1);peer.remoteDescription={type:'answer',sdp:'fixture-answer'};peer.signalingState='stable';peer.emitState('connected');},
  failPeer(){observations.peers.at(-1).emitState('failed');},
  stalePeerState(){observations.peers[0].emitState('connected');},
  signal(type,payload){for(const listener of listeners)listener({type:'rtc.signal.received',payload:{signal:{callId:'call-1',fromUserId:'joiner',targetUserId:'creator',type,payload:btoa(payload)}}});},
  deferLeave,
  finishLeave,
  failLeave,
  observeInactive(){opts.joinCoordinator.observeChat('chat-1',null,opts.joinCoordinator.observationVersion());opts.awarenessEntry=null;root.render(React.createElement(Harness));},
  changeAccount(){opts.currentUserId='joiner';opts.token='synthetic-joiner';},
  changeScope(){opts.chat={id:'chat-2',kind:'direct'};opts.awarenessEntry=null;root.render(React.createElement(Harness));},
  emitTrack(){const event=new Event('track');Object.defineProperties(event,{streams:{value:[stream()]},track:{value:track}});observations.peers.at(-1).dispatchEvent(event);},
  unmount(){root.unmount();},
  sync(){opts.awarenessEntry={call, participants:[...participants], syncStatus:'ready',errorMessage:null};root.render(React.createElement(Harness));},
  block(value){blocked=value;},
  deferPlayback(){deferPlayback=true;},
  completePlayback(rejectResult){completePlayback(rejectResult);},
  retry(){return session.retryRemoteAudioPlayback(audio);},
  report(){return {...observations, candidatePending,candidates,canJoin:session?.canJoin, canToggleMicrophone:session?.canToggleMicrophone, isMicrophoneMuted:session?.isMicrophoneMuted, trackEnabled:track.enabled, signals:gatewayState.signals, configurationPending:gatewayState.configurationPending, peers:observations.peers.length, attached:audio.srcObject!==null, log, state:session?.state};},
};
