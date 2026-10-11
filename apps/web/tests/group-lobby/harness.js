import React from 'react';
import {createRoot} from 'react-dom/client';
import {useGroupLobbyHeartbeat} from '../../src/rtc/useGroupLobbyHeartbeat';
import {selectOwnedGroupLobbyCallId} from '../../src/rtc/group-lobby-heartbeat';
import {touches} from './gateway.js';
const media={captures:0,peers:0};
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia(){media.captures++;throw new Error('lobby must not capture');}}});
window.RTCPeerConnection=function(){media.peers++;throw new Error('lobby must not create peers');};
const entry={groupId:'group-1',call:{id:'call-1',status:'active',scope:{kind:'group',groupId:'group-1'}},participants:[{userId:'user-1',state:'active'}]};
let ownership=null;
let role='member';
let visible=true;
let root;
function Harness(){
  const callId=selectOwnedGroupLobbyCallId({ownership,entry,currentUserId:'user-1',selfRole:role});
  useGroupLobbyHeartbeat({token:'synthetic',callId,pageVisible:visible,onSuccess(){},onFailure(error){throw error;}});
  return React.createElement('p',null,'Lobby only');
}
const render=()=>root.render(React.createElement(Harness));
window.lobby={
  mount(){root=createRoot(document.getElementById('root'));render();},
  join(){ownership={callId:'call-1',groupId:'group-1',userId:'user-1'};render();},
  leave(){ownership=null;render();},
  reader(){role='reader';render();},
  visibility(value){visible=value;render();},
  unmount(){root.unmount();},
  report(){return{touches:[...touches],...media,audioElements:document.querySelectorAll('audio').length};},
};
