import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const here=fileURLToPath(new URL('.',import.meta.url));
const web=fileURLToPath(new URL('../../',import.meta.url));
const sourceRoot=process.env.READ_EFFECT_SOURCE_ROOT??web;
const lanes=[
 {file:'pages/ChatsPage.tsx',predicate:'shouldAutoMarkEncryptedRead',name:'useDirectEncryptedRead',lane:'directEncrypted'},
 {file:'pages/GroupsPage.tsx',predicate:'shouldAutoMarkGroupRead',name:'useGroupRead',lane:'group'},
 {file:'pages/GroupsPage.tsx',predicate:'shouldAutoMarkEncryptedGroupRead',name:'useGroupEncryptedRead',lane:'groupEncrypted'},
 {file:'chats/useChats.ts',predicate:'shouldAutoMarkRead',name:'useDirectRead',lane:'direct'},
];
// Явный список binding сохраняет исходный predicate/effect без переписывания тела.
const locals='enabled,authState,desktopShellHost,groupWindowContentMode,isPageVisible,isThreadRouteActive,selectedThread,encryptedLane,latestEncryptedMessage,selectedState,latestSelectedMessage,encryptedGroupLane,latestEncryptedGroupMessage,activeEncryptedDirectChatId,activeEncryptedGroupId,state,activeThreadChatId,latestThreadMessage,latestThreadMessageId,currentUserId,sessionToken,token,mountedRef,selectedStateRef,setGroups,gatewayClient,applyEncryptedReadState,dispatch,setSelectedState,setComposerError,expireSession,describeGatewayError,isGatewayErrorCode,resolveProtectedError,setActionError';
let moduleSource=`import {useEffect} from 'react';import {isThreadReadVisible} from '${web}src/chats/read-visibility.ts';\n`;
for(const lane of lanes){
 const source=await readFile(sourceRoot+'src/'+lane.file,'utf8');
 const start=source.indexOf(`  const ${lane.predicate} =`);
 const predicateEnd=source.indexOf(';',start)+1;
 const guard=source.indexOf(`!${lane.predicate}`,predicateEnd);
 const effectStart=source.lastIndexOf('  useEffect(() => {',guard);
 const effectEnd=source.indexOf(']);',guard)+3;
 assert.ok(start>=0&&effectStart>=predicateEnd&&effectEnd>effectStart);
 moduleSource+=`export function ${lane.name}(opts){const {${locals}}=opts;const isThreadVisible=isThreadReadVisible({pageVisible:isPageVisible,windowVisible:desktopShellHost.isCurrentWindowVisible,timelineVisible:true});const threadVisible=isThreadVisible;${source.slice(start,predicateEnd)}\n${source.slice(effectStart,effectEnd)}\n}\n`;
}
const server=await createServer({configFile:false,root:here,resolve:{alias:[
 {find:/^react$/,replacement:web+'node_modules/react/index.js'},
 {find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'},
]},plugins:[{name:'read-effects-fixture',resolveId(id){if(id==='virtual:read-effects')return '\0read-effects';},load(id){if(id==='\0read-effects')return moduleSource;}}],server:{host:'127.0.0.1',port:Number(process.env.READ_FIXTURE_PORT??25174),strictPort:true,fs:{allow:[web,here]}}});
await server.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
const evidence=[];
try{
 const page=await browser.newPage();
 for(const lane of lanes){
  await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.fixture);
  await page.evaluate(lane=>window.fixture.mount(lane),lane.lane);await page.waitForTimeout(50);
  let report=await page.evaluate(()=>window.fixture.report());
  assert.deepEqual(report,{readCount:0,unread:1},lane.lane+' minimized retains unread');
  await page.evaluate(()=>window.fixture.render({isPageVisible:false}));await page.evaluate(()=>window.fixture.restore());await page.waitForTimeout(50);
  report=await page.evaluate(()=>window.fixture.report());assert.equal(report.readCount,0,lane.lane+' hidden tab retains unread');
  if(lane.lane.startsWith('group')){
   await page.evaluate(()=>window.fixture.render({isPageVisible:true,groupWindowContentMode:'info'}));await page.waitForTimeout(50);
   report=await page.evaluate(()=>window.fixture.report());assert.equal(report.readCount,0,lane.lane+' info view retains unread');
  }
  await page.evaluate(()=>window.fixture.render({isPageVisible:true,groupWindowContentMode:'thread'}));
  await page.waitForFunction(()=>window.fixture.report().readCount===1);
  report=await page.evaluate(()=>window.fixture.report());assert.deepEqual(report,{readCount:1,unread:0},lane.lane+' restored reads');
  await page.evaluate(()=>window.fixture.unmount());evidence.push({lane:lane.lane,...report});
 }
 console.log(JSON.stringify({browser:await browser.version(),evidence,scope:'Actual React effects extracted unchanged from production; synthetic gateway, no two-account or real crypto evidence'}));
}finally{await browser.close();await server.close();}
