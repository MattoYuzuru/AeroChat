import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useGroupLobbyHeartbeat} from '../../src/rtc/useGroupLobbyHeartbeat';
import {selectOwnedGroupLobbyCallId} from '../../src/rtc/group-lobby-heartbeat';
import {createActions,useOwnershipLifecycle} from 'virtual:lobby-actions';
import {deferMutation,finishMutation,gatewayClient,mutations,touches} from './gateway.js';
const media={captures:0,peers:0};
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia(){media.captures++;throw new Error('lobby must not capture');}}});
window.RTCPeerConnection=function(){media.peers++;throw new Error('lobby must not create peers');};
const entry={groupId:'group-1',call:{id:'call-1',status:'active',scope:{kind:'group',groupId:'group-1'}},participants:[{userId:'user-1',state:'active'}]};
let role='member';
let visible=true;
let selectedGroupId='group-1';
let root;
let actions;
let ownershipSnapshot=null;
let ownershipWrites=0;
let commits=0;
function Harness(){
  const [ownership,setOwnership]=useState(null);
  const groupLobbyGenerationRef=useRef(0);
  const setGroupLobbyOwnership=value=>{if(value!==null)ownershipWrites++;setOwnership(value);};
  useOwnershipLifecycle({groupLobbyGenerationRef,setGroupLobbyOwnership,setGroupCallHeartbeatError(){},currentUserId:'user-1',selectedGroupId});
  ownershipSnapshot=ownership;
  const callId=selectOwnedGroupLobbyCallId({ownership,entry:selectedGroupId===entry.groupId?entry:null,currentUserId:'user-1',selfRole:role});
  useGroupLobbyHeartbeat({token:'synthetic',callId,pageVisible:visible,onSuccess(){},onFailure(error){throw error;}});
  actions=createActions({
    gatewayClient,token:'synthetic',currentUserId:'user-1',
    selectedState:{status:'ready',snapshot:{group:{id:selectedGroupId}}},
    selectedGroupCallEntry:entry,selectedGroupCallActions:{canStart:true,canJoin:true,canLeave:true,canEnd:true},
    groupLobbyGenerationRef,setGroupLobbyOwnership,
    setGroupCallActionState(){},setGroupCallTerminalState(){},setGroupCallError(){},
    refreshGroupCall:async()=>{},isRTCActiveCallConflict:()=>false,
    isGatewayErrorCode:()=>false,describeGroupCallConflictMessage:()=>'',
    resolveProtectedError:()=>'',expireSession(){},
  });
  useEffect(()=>{commits++;});
  return React.createElement('p',null,'Lobby only');
}
const render=()=>root.render(React.createElement(Harness));
window.lobby={
  mount(){root=createRoot(document.getElementById('root'));render();},
  start(){return actions.handleStartGroupCall();},
  join(){return actions.handleJoinGroupCall();},
  beginDeferred(type){deferMutation();void(type==='start'?actions.handleStartGroupCall():actions.handleJoinGroupCall());},
  finishMutation,
  scope(){selectedGroupId='group-2';render();},
  leave(){return actions.handleLeaveGroupCall();},
  reader(){role='reader';render();},
  visibility(value){visible=value;render();},
  unmount(){root.unmount();},
  report(){return{touches:[...touches],mutations:[...mutations],ownership:ownershipSnapshot,ownershipWrites,commits,...media,audioElements:document.querySelectorAll('audio').length};},
};
