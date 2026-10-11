import React from 'react';
import {createRoot} from 'react-dom/client';
import {useDirectCallSession} from '../../src/rtc/useDirectCallSession';
import {usePlayback} from 'virtual:playback';
import {call, participants, log} from './gateway.js';

const observations = { stops: 0, plays: 0, pauses: 0, peers: [] };
let blocked = false;
const audio = {srcObject: null, pause(){observations.pauses++;}, play(){observations.plays++;if(observations.plays>3)return new Promise(()=>{});return blocked ? Promise.reject(new Error('blocked')) : Promise.resolve();}};
const track = {stop:()=>observations.stops++, contentHint:'', kind:'audio'};
const stream = () => ({getTracks:()=>[track], getAudioTracks:()=>[track]});
Object.defineProperty(navigator, 'mediaDevices', {configurable:true, value:{getSupportedConstraints:()=>({}), getUserMedia:async()=>stream()}});
class FakePeer extends EventTarget {
  connectionState = 'new'; iceConnectionState = 'new'; signalingState = 'stable'; remoteDescription = null;
  constructor(){super();observations.peers.push(this);}
  addTrack(){return {getParameters:()=>({encodings:[{}]}), setParameters:async()=>{}, track};}
  close(){this.connectionState='closed'; this.signalingState='closed';}
  async createOffer(){return {type:'offer',sdp:'fixture-offer'};}
  async setLocalDescription(desc){this.signalingState=desc.type==='offer'?'have-local-offer':'stable';}
  async setRemoteDescription(desc){this.remoteDescription=desc; this.signalingState='stable';}
  async addIceCandidate(){}
}
window.RTCPeerConnection = FakePeer;
let session;
let root;
const opts = {enabled:true, token:'synthetic', chat:{id:'chat-1',kind:'direct'}, awarenessEntry:null, awarenessSyncStatus:'ready', currentUserId:'creator', pageVisible:true, refreshDirectChatCall:async()=>{}, onUnauthenticated:()=>{}};
function Harness(){
  session=useDirectCallSession(opts);
  usePlayback({directCallAudioRef:{current:audio}, directCallRemoteAudioStream:session.remoteAudioStream, retryDirectCallRemoteAudioPlayback:session.retryRemoteAudioPlayback});
  return React.createElement('pre',null,JSON.stringify(session.state));
}
window.fixture = {
  mount(){root=createRoot(document.getElementById('root'));root.render(React.createElement(Harness));},
  start(){return session.startCall();},
  emitTrack(){const event=new Event('track');Object.defineProperties(event,{streams:{value:[stream()]},track:{value:track}});observations.peers.at(-1).dispatchEvent(event);},
  unmount(){root.unmount();},
  sync(){opts.awarenessEntry={call, participants:[...participants], syncStatus:'ready',errorMessage:null};root.render(React.createElement(Harness));},
  block(value){blocked=value;},
  retry(){return session.retryRemoteAudioPlayback(audio);},
  report(){return {...observations, peers:observations.peers.length, attached:audio.srcObject!==null, log, state:session?.state};},
};
