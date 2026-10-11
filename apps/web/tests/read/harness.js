import React from 'react';
import {createRoot} from 'react-dom/client';
import {useDirectEncryptedRead,useGroupRead,useGroupEncryptedRead,useDirectRead} from 'virtual:read-effects';
const hooks={directEncrypted:useDirectEncryptedRead,group:useGroupRead,groupEncrypted:useGroupEncryptedRead,direct:useDirectRead};
let root,opts,readCount=0,unread=1;
const position={selfPosition:null};
const incoming={id:'message-1',messageId:'message-1',senderUserId:'peer'};
const noop=()=>{};
function Harness(){hooks[opts.lane](opts);return React.createElement('p',null,'Synthetic read effect fixture');}
window.fixture={
 mount(lane){
  readCount=0;unread=1;
  const markRead=async()=>{readCount++;return {readState:position,unreadCount:0};};
  const group={id:'group-1',unreadCount:1,encryptedUnreadCount:1};
  opts={lane,enabled:true,authState:{status:'authenticated',profile:{id:'self'}},
   desktopShellHost:{isCurrentWindowVisible:false},groupWindowContentMode:'thread',
   isPageVisible:true,isThreadRouteActive:true,selectedThread:{encryptedReadState:position},encryptedLane:{status:'ready'},
   latestEncryptedMessage:incoming,selectedState:{status:'ready',snapshot:{group,readState:position,encryptedReadState:position}},
   latestSelectedMessage:incoming,encryptedGroupLane:{status:'ready'},latestEncryptedGroupMessage:incoming,
   activeEncryptedDirectChatId:'chat-1',activeEncryptedGroupId:'group-1',
   state:{threadStatus:'ready',thread:{chat:{id:'chat-1'},readState:position}},activeThreadChatId:'chat-1',
   latestThreadMessage:incoming,latestThreadMessageId:'message-1',currentUserId:'self',sessionToken:'synthetic',token:'synthetic',
   mountedRef:{current:true},selectedStateRef:{current:null},setGroups:noop,
   gatewayClient:{markEncryptedDirectChatRead:markRead,markGroupChatRead:markRead,markEncryptedGroupChatRead:markRead,markDirectChatRead:markRead},
   applyEncryptedReadState:(_id,_read,count)=>{unread=count;},dispatch:action=>{unread=action.unreadCount;},
   setSelectedState:update=>{const next=update(opts.selectedState);unread=lane==='group'?next.snapshot.group.unreadCount:next.snapshot.group.encryptedUnreadCount;},
   setComposerError:noop,expireSession:noop,describeGatewayError:noop,isGatewayErrorCode:noop,resolveProtectedError:noop,setActionError:noop};
  root=createRoot(document.getElementById('root'));root.render(React.createElement(Harness));
 },
 render(values){Object.assign(opts,values);root.render(React.createElement(Harness));},
 restore(){opts.desktopShellHost={isCurrentWindowVisible:true};root.render(React.createElement(Harness));},
 unmount(){root.unmount();},report(){return {readCount,unread};}
};
