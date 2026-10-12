import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const here=fileURLToPath(new URL('.',import.meta.url)),web=fileURLToPath(new URL('../../',import.meta.url));
assert.ok(process.env.LOCAL_CALL_OWNER_ARTIFACT_DIR,'private external artifact directory required');
const artifacts=process.env.LOCAL_CALL_OWNER_ARTIFACT_DIR;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const server=await createServer({configFile:false,root:here,optimizeDeps:{entries:['owner-index.html']},resolve:{alias:[
  {find:/^react$/,replacement:web+'node_modules/react/index.js'},
  {find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'},
]},plugins:[{name:'local-call-owner-fixture',enforce:'pre',resolveId(id,importer){
  if(importer?.endsWith('/rtc/useDirectCallSession.ts')){
    if(id==='../gateway/runtime')return here+'owner-gateway.js';
    if(id==='../realtime/events')return here+'realtime.js';
  }
}}],server:{host:'127.0.0.1',port:Number(process.env.RTC_FIXTURE_PORT??25174),strictPort:true,fs:{allow:[here,web]}}});
let browser,page,currentCase='setup',artifactOwned=false;const cases=[],pageErrors=[];
const report=()=>page.evaluate(()=>window.fixture.report());
const stage=async(name,run)=>{currentCase=name;await run();cases.push({name,status:'pass',result:await report()});};
async function fresh({second=false,strict=false}={}){
  await page.goto(server.resolvedUrls.local[0]+'owner-index.html');
  await page.waitForFunction(()=>window.fixture);
  await page.evaluate(strict=>window.fixture.mount('a',strict),strict);
  await page.locator('[data-window="a"][data-ready="ready"][data-provider-sync="ready"]').waitFor();
  if(second){await page.evaluate(()=>window.fixture.mount('b'));await page.locator('[data-window="b"][data-ready="ready"][data-provider-sync="ready"]').waitFor();}
}
async function joined(){await page.evaluate(()=>window.fixture.start());await page.getByRole('button',{name:'Выключить микрофон',exact:true}).waitFor();await page.waitForFunction(()=>window.fixture.report().peers>=1);assert.equal((await report()).slot.phase,'retained');}
const mutationCount=(r,method)=>r.log.filter(entry=>entry.method===method).length;
const stopped=r=>r.tracks.every(track=>track.readyState==='ended');
async function assertBoundaryRefresh(boundary){
  if(!['token','account','scope'].includes(boundary))return;
  const expected=await page.evaluate(()=>window.expectedBoundary);
  await page.waitForFunction(expected=>window.fixture.report().refreshes.slice(expected.start).some(record=>record.showLoading&&record.readyCommit),expected);
  const requests=(await report()).refreshes.slice(expected.start);
  assert.ok(requests.length>0);
  for(const request of requests){
    assert.equal(request.scopeId,expected.scopeId,'new boundary refresh must use current scope');
    assert.equal(request.userId,expected.userId,'new boundary refresh must use current account');
    assert.equal(request.epochId,expected.epochId,'new boundary refresh must use current auth epoch');
    assert.equal(request.tokenMatchesCurrent,true,'no previous token callback invocation');
    assert.equal(request.userMatchesCurrent,true);assert.equal(request.scopeMatchesCurrent,true);assert.equal(request.epochMatchesCurrent,true);
    if(request.showLoading){assert.equal(request.loadingCommit.status,'loading');assert.equal(request.readyCommit.status,'ready');assert.ok(request.loadingCommit.sequence<request.readyCommit.sequence,'actual loading commit precedes actual success commit');}
  }
}
try{
  await mkdir(artifacts,{recursive:false,mode:0o700});artifactOwned=true;
  await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});page=await browser.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>pageErrors.push(error.message));
  await stage('retained-after-join-blocks-second-window',async()=>{
    await fresh({second:true});await joined();
    await page.locator('[data-window="b"]').getByRole('button',{name:'Начать звонок',exact:true}).waitFor();
    assert.equal(await page.locator('[data-window="b"]').getByRole('button',{name:'Начать звонок',exact:true}).isDisabled(),true);
    await page.locator('[data-window="b"]').getByRole('alert').filter({hasText:'другой звонок'}).waitFor();
    await page.evaluate(()=>window.fixture.start('b'));const r=await report();assert.equal(r.captures,1);assert.equal(mutationCount(r,'start'),1);assert.equal(r.liveTracks,1);
    await page.evaluate(()=>window.fixture.leave());await page.waitForFunction(()=>window.fixture.report().slot===null);
    await page.locator('[data-window="b"]').getByRole('alert').waitFor({state:'detached'});
    await page.evaluate(()=>window.fixture.start('b'));assert.equal((await report()).captures,2);
  });
  await stage('group-kind-contract-closing-ui-not-sdk',async()=>{
    await fresh();await page.evaluate(()=>window.fixture.reserveGroup());
    await page.locator('[data-window="a"]').getByRole('alert').filter({hasText:'другой звонок'}).waitFor();
    await page.evaluate(()=>window.fixture.start());assert.equal((await report()).captures,0);
    await page.evaluate(()=>window.fixture.dismiss());await page.getByRole('alert').waitFor({state:'detached'});
    assert.equal(await page.getByRole('button',{name:'Начать звонок',exact:true}).isDisabled(),true);
    await page.evaluate(()=>window.fixture.closeGroup());await page.locator('[data-window="a"]').getByRole('alert').filter({hasText:'ещё завершается'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Начать звонок',exact:true}).isDisabled(),true);
    await page.evaluate(()=>window.fixture.releaseGroup());await page.waitForFunction(()=>window.fixture.report().sessions.a.canStart);await joined();
  });
  for(const action of ['leave','end'])await stage(action+'-stops-before-pending-async-exit',async()=>{
    await fresh();await joined();if(action==='leave')await page.evaluate(()=>window.fixture.deferLeave());await page.evaluate(action=>window.fixture[action](),action);
    const r=await report();assert.equal(r.slot,null);assert.equal(stopped(r),true);assert.ok(r.order.findIndex(entry=>entry.startsWith('stop:'))<r.order.indexOf('rpc:'+action));
    if(action==='leave')await page.evaluate(()=>window.fixture.finishLeave());
  });
  await stage('permission-denial-releases-and-retains-error',async()=>{
    await fresh();await page.evaluate(()=>{window.fixture.deferCapture();window.pending=window.fixture.start();});await page.waitForFunction(()=>window.fixture.report().captures===1);
    await page.evaluate(()=>window.fixture.rejectCapture());await page.evaluate(()=>window.pending);let r=await report();assert.equal(r.slot,null);assert.equal(r.sessions.a.state.mediaState,'denied');assert.equal(mutationCount(r,'start'),0);
    await page.getByRole('alert').waitFor();await joined();r=await report();assert.equal(r.captures,2);assert.equal(r.liveTracks,1);
  });
  await stage('rpc-failure-stops-and-releases-own-capture',async()=>{
    await fresh();await page.evaluate(()=>{window.fixture.failMutation(true);return window.fixture.start();});let r=await report();assert.equal(r.slot,null);assert.equal(stopped(r),true);assert.match(r.sessions.a.state.errorMessage,/owned synthetic mutation failure/);
    await page.evaluate(()=>window.fixture.failMutation(false));await joined();r=await report();assert.equal(r.captures,2);assert.equal(r.liveTracks,1);
  });
  for(const boundary of ['unmount','token','account','scope','disabled'])await stage('late-capture-'+boundary,async()=>{
    await fresh();await page.evaluate(()=>{window.fixture.deferCapture();window.pending=window.fixture.start();});await page.waitForFunction(()=>window.fixture.report().captures===1);
    await page.evaluate(boundary=>{if(boundary==='unmount')window.fixture.unmount();else window.expectedBoundary=window.fixture.boundary(boundary);},boundary);
    await page.waitForFunction(()=>window.fixture.report().slot?.phase==='closing');
    if(boundary==='unmount'){await page.evaluate(()=>window.fixture.mount());await page.locator('[data-window="a"][data-ready="ready"][data-provider-sync="ready"]').waitFor();}
    else await page.locator('[data-window="a"][data-ready="ready"][data-provider-sync="ready"]').waitFor();
    await assertBoundaryRefresh(boundary);
    await page.evaluate(()=>window.fixture.start());let r=await report();assert.equal(r.captures,1);assert.equal(mutationCount(r,'start'),0);assert.equal(r.slot.phase,'closing');
    await page.evaluate(()=>window.fixture.releaseCapture(2));await page.evaluate(()=>window.pending);await page.waitForFunction(()=>window.fixture.report().slot===null);r=await report();assert.equal(r.tracks.length,2);assert.equal(stopped(r),true);assert.equal(mutationCount(r,'start'),0);
    if(boundary!=='disabled'){await joined();r=await report();assert.equal(r.captures,2);assert.equal(r.liveTracks,1);}
  });
  for(const phase of ['configuration','mutation'])await stage('unmount-during-'+phase+'-holds-until-settlement',async()=>{
    await fresh();await page.evaluate(phase=>{window.fixture[phase==='configuration'?'deferConfiguration':'deferMutation']();window.pending=window.fixture.start();},phase);
    await page.waitForFunction(phase=>window.fixture.report().log.some(entry=>entry.method===(phase==='configuration'?'configuration-pending':'start')),phase);
    await page.evaluate(()=>{window.fixture.unmount();window.fixture.mount();});await page.locator('[data-window="a"][data-ready="ready"][data-provider-sync="ready"]').waitFor();
    let r=await report();assert.equal(stopped(r),true);assert.equal(r.slot.phase,'closing');await page.evaluate(()=>window.fixture.start());assert.equal((await report()).captures,1);
    await page.evaluate(phase=>window.fixture[phase==='configuration'?'finishConfiguration':'finishMutation'](),phase);await page.evaluate(()=>window.pending);await page.waitForFunction(()=>window.fixture.report().slot===null);
    r=await report();assert.equal(mutationCount(r,'start'),phase==='mutation'?1:0);assert.equal(mutationCount(r,'leave'),phase==='mutation'?1:0);
  });
  await stage('mute-peer-departure-return-minimize-retains-identity',async()=>{
    await fresh();await joined();const initial=await report();assert.ok(initial.currentPeer);const priorCount=initial.peers,priorId=initial.currentPeer.id,trackId=initial.tracks[0].id;
    await page.evaluate(()=>{window.fixture.toggle();window.fixture.minimize();window.fixture.peer(false);});await page.waitForFunction(()=>window.fixture.report().sessions.a.state.peerConnectionState==='waiting_for_peer');
    let r=await report();assert.equal(r.peers,priorCount,'departure creates no extra peer');assert.equal(r.peerRecords.find(peer=>peer.id===priorId).closed,true,'actual owned peer is closed');assert.equal(r.currentPeer,null);assert.equal(r.slot.phase,'retained');assert.equal(r.tracks[0].enabled,false);assert.equal(r.tracks[0].id,trackId);assert.equal(r.liveTracks,1);
    await page.evaluate(()=>{window.fixture.peer(true);window.fixture.minimize('a',false);});await page.waitForFunction(prior=>window.fixture.report().peers===prior+1&&window.fixture.report().currentPeer!==null,priorCount);
    r=await report();assert.equal(r.peers,priorCount+1);assert.notEqual(r.currentPeer.id,priorId);assert.deepEqual(r.currentPeer.captureIds,[trackId]);const returnedId=r.currentPeer.id;
    await page.evaluate(id=>window.fixture.connectPeer(id),returnedId);await page.waitForFunction(()=>window.fixture.report().sessions.a.state.peerConnectionState==='connected');
    r=await report();assert.equal(r.currentPeer.id,returnedId);assert.equal(r.peerEvents.at(-1).id,returnedId,'event is delivered to the actual production-owned current peer');assert.equal(r.captures,1);assert.equal(r.tracks[0].id,'capture-1-0');assert.equal(r.tracks[0].enabled,false);assert.equal(r.sessions.a.isMicrophoneMuted,true);assert.equal(r.slot.phase,'retained');
  });
  await stage('ended-track-not-fake-call-release',async()=>{
    await fresh();await joined();await page.evaluate(()=>window.fixture.endCapture());await page.waitForFunction(()=>!window.fixture.report().sessions.a.canToggleMicrophone);assert.equal((await report()).slot.phase,'retained');
    await page.evaluate(()=>window.fixture.leave());assert.equal((await report()).slot,null);
  });
  for(const boundary of ['token','account','scope','disabled'])await stage('active-'+boundary+'-cleans-local-owner',async()=>{
    await fresh();await joined();await page.evaluate(boundary=>{window.expectedBoundary=window.fixture.boundary(boundary);},boundary);await page.waitForFunction(()=>window.fixture.report().slot===null);
    await assertBoundaryRefresh(boundary);
    const r=await report();assert.equal(stopped(r),true);assert.equal(r.captures,1);assert.equal(mutationCount(r,'start'),1);
  });
  await stage('strictmode-remount-and-cleanup-do-not-release-new-owner',async()=>{
    await fresh({strict:true});await joined();await page.evaluate(()=>window.fixture.unmount());await page.locator('[data-window="a"]').waitFor({state:'detached'});assert.equal((await report()).slot,null);
    await page.evaluate(()=>window.fixture.mount('a',true));await page.locator('[data-window="a"][data-ready="ready"][data-provider-sync="ready"]').waitFor();await page.evaluate(()=>window.fixture.join());await page.getByRole('button',{name:'Выключить микрофон',exact:true}).waitFor();assert.equal((await report()).slot.phase,'retained');assert.equal((await report()).captures,2);
  });
  assert.deepEqual(pageErrors,[]);
  const hashes={};for(const path of ['src/rtc/useDirectCallSession.ts','src/rtc/local-call-capture-owner.ts','src/rtc/awareness.ts','tests/rtc/owner-harness.jsx'])hashes[path]=createHash('sha256').update(await readFile(web+path)).digest('hex');
  const result={browser:await browser.version(),cases:cases.length,pageErrors,sourceSHA256:hashes,evidence:cases,scope:'Actual React/direct production hook, local owner and awareness reducer; immutable per-render refresh context and committed loading/ready, synthetic media/PC/RPC. Group-kind reservation is only arbitration contract, not SDK/group audio; no recorder-wide exclusion/backend/device/audibility claims.'};
  await writeFile(artifacts+'/evidence.json',JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));
}catch(error){
  if(artifactOwned){await writeFile(artifacts+'/failure.json',JSON.stringify({case:currentCase,message:error.message,cases,pageErrors,result:page?await report().catch(()=>null):null},null,2)+'\n',{mode:0o600,flag:'wx'});if(page)await page.screenshot({path:artifacts+'/failure.png',fullPage:true}).catch(()=>{});}throw error;
}finally{
  try{if(page)await page.evaluate(()=>{for(const id of ['a','b'])if(window.fixture.report().sessions[id])window.fixture.unmount(id);}).catch(()=>{});if(browser)await browser.close();}finally{await server.close();}
}
