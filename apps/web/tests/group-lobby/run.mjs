import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const here=fileURLToPath(new URL('.',import.meta.url));
const web=fileURLToPath(new URL('../../',import.meta.url));
const source=await readFile(web+'src/pages/GroupsPage.tsx','utf8');
const actionStart=source.indexOf('  async function handleStartGroupCall() {');
const actionEnd=source.indexOf('  async function handleCreateGroup(',actionStart);
assert.ok(actionStart>=0&&actionEnd>actionStart,'exact production Start/Join handlers must be found');
const effectStart=source.indexOf('  useEffect(() => {\n    groupLobbyGenerationRef.current += 1;');
const effectSuffix='  }, [currentUserId, selectedGroupId]);';
const effectEnd=source.indexOf(effectSuffix,effectStart);
assert.ok(effectStart>=0&&effectEnd>effectStart,'exact production ownership lifecycle effect must be found');
const actions=source.slice(actionStart,actionEnd);
const effect=source.slice(effectStart,effectEnd+effectSuffix.length);
const server=await createServer({configFile:false,root:here,resolve:{alias:[
  {find:/^react$/,replacement:web+'node_modules/react/index.js'},
  {find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'},
]},plugins:[{name:'lobby-fixture',enforce:'pre',resolveId(source,importer){
  if(source==='virtual:lobby-actions')return '\0lobby-actions';
  if(importer?.endsWith('/rtc/useGroupLobbyHeartbeat.ts')&&source==='../gateway/runtime')return here+'gateway.js';
},load(id){if(id==='\0lobby-actions')return `import {useEffect} from 'react';
export function useOwnershipLifecycle({groupLobbyGenerationRef,setGroupLobbyOwnership,setGroupCallHeartbeatError,currentUserId,selectedGroupId}){${effect}}
export function createActions({gatewayClient,token,currentUserId,selectedState,selectedGroupCallEntry,selectedGroupCallActions,groupLobbyGenerationRef,setGroupLobbyOwnership,setGroupCallActionState,setGroupCallTerminalState,setGroupCallError,refreshGroupCall,isRTCActiveCallConflict,isGatewayErrorCode,describeGroupCallConflictMessage,resolveProtectedError,expireSession}){${actions}return {handleStartGroupCall,handleJoinGroupCall,handleLeaveGroupCall,handleEndGroupCall};}`;}}],server:{host:'127.0.0.1',port:Number(process.env.RTC_FIXTURE_PORT??25173),strictPort:true,fs:{allow:[web,here]}}});
await server.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
try {
  const page=await browser.newPage();
  await page.clock.install();
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(()=>window.lobby);
  await page.evaluate(()=>window.lobby.mount());
  await page.waitForFunction(()=>window.lobby.report().commits>0);
  await page.clock.runFor(180_000);
  assert.equal((await page.evaluate(()=>window.lobby.report())).touches.length,0,'observer cannot extend foreign participation');
  await page.evaluate(()=>window.lobby.join());
  await page.waitForFunction(()=>window.lobby.report().ownership!==null);
  await page.clock.runFor(180_000);
  let result=await page.evaluate(()=>window.lobby.report());
  assert.equal(result.touches.length,10,'joined lobby sends immediate and 20 second touches');
  await page.evaluate(()=>window.lobby.visibility(false));
  await page.waitForTimeout(25);
  await page.clock.runFor(180_000);
  assert.equal((await page.evaluate(()=>window.lobby.report())).touches.length,10,'hidden page stops heartbeat');
  await page.evaluate(()=>window.lobby.visibility(true));
  await page.waitForTimeout(25);
  await page.clock.runFor(1);
  assert.equal((await page.evaluate(()=>window.lobby.report())).touches.length,11);
  await page.evaluate(()=>window.lobby.reader());
  await page.waitForTimeout(25);
  await page.clock.runFor(180_000);
  result=await page.evaluate(()=>window.lobby.report());
  assert.equal(result.touches.length,11,'reader downgrade stops heartbeat');
  await page.evaluate(()=>window.lobby.leave());
  await page.clock.runFor(180_000);
  await page.evaluate(()=>window.lobby.unmount());
  await page.clock.runFor(180_000);
  result=await page.evaluate(()=>window.lobby.report());
  assert.equal(result.touches.length,11);
  assert.equal(result.captures,0);assert.equal(result.peers,0);assert.equal(result.audioElements,0);
  for(const action of ['start','join']){
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(()=>window.lobby);
    await page.evaluate(()=>window.lobby.mount());
    await page.waitForFunction(()=>window.lobby.report().commits>0);
    await page.evaluate(action=>window.lobby[action](),action);
    await page.waitForFunction(()=>window.lobby.report().ownership!==null);
    await page.clock.runFor(180_000);
    assert.equal((await page.evaluate(()=>window.lobby.report())).touches.length,10,`${action}: successful production handler owns heartbeat`);
    await page.evaluate(()=>window.lobby.leave());
    await page.waitForFunction(()=>window.lobby.report().ownership===null);
    await page.clock.runFor(180_000);
    assert.equal((await page.evaluate(()=>window.lobby.report())).touches.length,10,`${action}: explicit production Leave stops heartbeat`);
    await page.evaluate(()=>window.lobby.unmount());
    for(const cleanup of ['scope','unmount']){
      await page.goto(server.resolvedUrls.local[0]);
      await page.waitForFunction(()=>window.lobby);
      await page.evaluate(()=>window.lobby.mount());
      await page.waitForFunction(()=>window.lobby.report().commits>0);
      await page.evaluate(action=>window.lobby.beginDeferred(action),action);
      await page.waitForFunction(()=>window.lobby.report().mutations.length===1);
      await page.evaluate(cleanup=>window.lobby[cleanup](),cleanup);
      await page.waitForTimeout(25);
      await page.evaluate(()=>window.lobby.finishMutation());
      await page.clock.runFor(180_000);
      const late=await page.evaluate(()=>window.lobby.report());
      assert.equal(late.ownershipWrites,0,`${action}/${cleanup}: late success cannot own heartbeat`);
      assert.equal(late.touches.length,0,`${action}/${cleanup}: late success cannot renew participant`);
      assert.equal(late.captures,0);assert.equal(late.peers,0);
      if(cleanup==='scope')await page.evaluate(()=>window.lobby.unmount());
    }
  }
  console.log(JSON.stringify({browser:await browser.version(),...result,lateOwnershipCases:4,scope:'Actual React heartbeat hook, exact GroupsPage Start/Join handlers and ownership lifecycle effect; accelerated clock; fake RTC RPC; server liveness verified separately by real PostgreSQL test'}));
} finally {await browser.close();await server.close();}
