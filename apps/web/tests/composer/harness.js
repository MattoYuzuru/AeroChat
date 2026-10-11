import React from 'react';
import {createRoot} from 'react-dom/client';
import {useComposer} from 'virtual:composer';
let root,session,opts,resolveSend,rejectSend;
let calls=[],clears=0,failed=0,reply='reply-1',edit=null;
const noop=()=>{};
function Harness(){
 session=useComposer(opts);
 return React.createElement('form',{onSubmit:e=>{e.preventDefault();void session.send();}},[
  React.createElement('textarea',{key:'text','aria-label':'Message',value:session.text,onChange:session.onChange,onKeyDown:session.onKeyDown}),
  React.createElement('button',{key:'send',type:'submit',disabled:session.pending},'Send'),
 ]);
}
window.fixture={
 mount(){
  calls=[];clears=0;failed=0;reply='reply-1';edit=null;
  opts={selectedThread:{chat:{id:'chat-1'}},uploadedEncryptedAttachmentDraft:{attachmentId:'attachment-1'},
   editingEncryptedEntry:null,selectedEncryptedReplyEntry:{messageId:'reply-1'},selectedEncryptedReplyMessageId:reply,editingEncryptedMessageId:edit,
   setSelectedEncryptedReplyMessageId:value=>{reply=value;},setEditingEncryptedMessageId:value=>{edit=value;},
   chats:{state:{isSendingMessage:false},clearFeedback:noop},normalizeComposerMessageText:text=>text.trim(),
   cryptoRuntime:{state:{isActionPending:false},sendEncryptedDirectMessageV2Content(...args){calls.push(args);return new Promise((resolve,reject)=>{resolveSend=resolve;rejectSend=reject;});}},
   encryptedMediaAttachmentDraft:{isUploading:false,markSendSucceeded(){clears++;},markSendFailed(){failed++;}},publishLocalEncryptedDirectMessageV2Projection:noop};
  root=createRoot(document.getElementById('root'));root.render(React.createElement(Harness));
 },
 succeed(){resolveSend({localProjection:{}});},fail(){rejectSend(new Error('synthetic failure'));},
 cancel(){resolveSend(null);},
 twice(){void session.send();void session.send();},send(){void session.send();},
 switchThread(){opts={...opts,selectedThread:{chat:{id:'chat-2'}}};root.render(React.createElement(Harness));},
 changeReply(){reply='reply-2';opts={...opts,selectedEncryptedReplyMessageId:reply};root.render(React.createElement(Harness));},
 report(){return {calls:calls.map(args=>({chatId:args[0],text:args[1]})),text:session.text,currentReply:session.currentReply,pending:session.pending,error:session.error,clears,failed,reply,edit};},
 unmount(){root.unmount();}
};
