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
   setSelectedEncryptedReplyMessageId:value=>{reply=value;opts={...opts,selectedEncryptedReplyMessageId:value};root.render(React.createElement(Harness));},setEditingEncryptedMessageId:value=>{edit=value;opts={...opts,editingEncryptedMessageId:value};root.render(React.createElement(Harness));},
   chats:{state:{isSendingMessage:false},clearFeedback:noop},normalizeComposerMessageText:text=>text.trim(),
   cryptoRuntime:{state:{isActionPending:false},sendEncryptedDirectMessageV2Content(...args){calls.push({chatId:args[0],text:args[1]});return new Promise((resolve,reject)=>{resolveSend=resolve;rejectSend=reject;});},sendEncryptedDirectMessageV2Edit(...args){calls.push({chatId:args[0],text:args[3]});return new Promise((resolve,reject)=>{resolveSend=resolve;rejectSend=reject;});}},
   encryptedMediaAttachmentDraft:{isUploading:false,markSendSucceeded(){clears++;},markSendFailed(){failed++;}},publishLocalEncryptedDirectMessageV2Projection:noop};
  root=createRoot(document.getElementById('root'));root.render(React.createElement(Harness));
 },
 succeed(){resolveSend({localProjection:{}});},fail(){rejectSend(new Error('synthetic failure'));},
 cancel(){resolveSend(null);},
 twice(){void session.send();void session.send();},send(){void session.send();},
 switchThread(){opts={...opts,selectedThread:{chat:{id:'chat-2'}}};root.render(React.createElement(Harness));},
 edit(text){opts={...opts,editingEncryptedEntry:{messageId:'edit-1',revision:1}};session.edit({messageId:'edit-1',replyToMessageId:'reply-1',text});},cancelEdit(){session.cancelEdit();},
 changeReply(){reply='reply-2';opts={...opts,selectedEncryptedReplyMessageId:reply};root.render(React.createElement(Harness));},
 report(){return {calls,text:session.text,currentReply:session.currentReply,currentEdit:session.currentEdit,pending:session.pending,error:session.error,clears,failed,reply,edit};},
 unmount(){root.unmount();}
};
