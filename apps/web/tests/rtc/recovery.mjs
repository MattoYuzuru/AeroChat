import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

// Playwright и браузер передаются из локального test runtime, зависимости продукта не меняются.
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE);
const here = fileURLToPath(new URL('.', import.meta.url));
const web = fileURLToPath(new URL('../../', import.meta.url));
const source = await readFile(web + 'src/pages/ChatsPage.tsx', 'utf8');
const start = source.indexOf('  useEffect(() => {\n    const audioElement = directCallAudioRef.current;');
const end = source.indexOf('  }, [directCallRemoteAudioStream, retryDirectCallRemoteAudioPlayback]);', start);
assert.ok(start >= 0 && end >= start, 'ChatsPage playback effect must be found');
const effect = source.slice(start, end + '  }, [directCallRemoteAudioStream, retryDirectCallRemoteAudioPlayback]);'.length);
const server = await createServer({configFile:false,root:here,resolve:{alias:[
  {find:/^react$/,replacement:web+'node_modules/react/index.js'},
  {find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'},
]},plugins:[{name:'rtc-fixture',enforce:'pre',resolveId(id,importer){
  if(id==='virtual:playback')return '\0playback';
  if(importer?.endsWith('/rtc/useDirectCallSession.ts')){
    if(id==='../gateway/runtime')return here+'gateway.js';
    if(id==='../realtime/events')return here+'realtime.js';
  }
},load(id){if(id==='\0playback')return `import {useEffect} from 'react';export function usePlayback({directCallAudioRef,directCallRemoteAudioStream,retryDirectCallRemoteAudioPlayback}){${effect}}`;}}],server:{host:'127.0.0.1',port:Number(process.env.RTC_FIXTURE_PORT ?? 25173),strictPort:true,fs:{allow:[web,here]}}});
await server.listen();
const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
try {
  const page=await browser.newPage();
  const url=server.resolvedUrls.local[0];
  async function setup(){
    await page.goto(url);await page.waitForFunction(()=>window.fixture);
    await page.evaluate(()=>window.fixture.mount());
    await page.waitForFunction(()=>window.fixture.report().state.syncStatus==="ready");
    await page.evaluate(()=>window.fixture.start());
    await page.evaluate(()=>window.fixture.sync());
    await page.waitForTimeout(50);
    await page.evaluate(()=>window.fixture.connect());
    await page.waitForFunction(()=>window.fixture.report().state.peerConnectionState==="connected");
    return page.evaluate(()=>window.fixture.report());
  }
  const cases=[
    ["ice_candidate",JSON.stringify({candidate:"fixture-candidate",sdpMid:"0",sdpMLineIndex:0})],
    ["answer",JSON.stringify({type:"answer",sdp:"fixture-answer"})],
    ["ice_candidate","{malformed"],
  ];
  for(const [type,payload] of cases){
    const initial=await setup();await page.evaluate(()=>window.fixture.failPeer());
    await page.waitForTimeout(100);
    await page.evaluate(([type,payload])=>window.fixture.signal(type,payload),[type,payload]);
    await page.waitForTimeout(1000);
    const current=await page.evaluate(()=>window.fixture.report());
    assert.equal(current.peers,initial.peers+1,`${type}: late signal must preserve retry`);
    assert.equal(current.signals.filter(type=>type==="offer").length,initial.signals.filter(type=>type==="offer").length+1);
    await page.evaluate(()=>window.fixture.unmount());
  }
  let initial=await setup();await page.evaluate(()=>window.fixture.failPeer());
  await page.evaluate(()=>window.fixture.signal("offer",JSON.stringify({type:"offer",sdp:"new-offer"})));
  await page.waitForFunction(()=>window.fixture.report().signals.includes("answer"));
  await page.evaluate(()=>window.fixture.connect());
  await page.waitForTimeout(1000);
  let current=await page.evaluate(()=>window.fixture.report());
  assert.equal(current.peers,initial.peers,"connected negotiation cancels retry");
  await page.evaluate(()=>window.fixture.unmount());
  initial=await setup();await page.evaluate(()=>window.fixture.failPeer());
  await page.waitForFunction(count=>window.fixture.report().peers===count+1,initial.peers);
  await page.evaluate(()=>{window.fixture.failPeer();window.fixture.stalePeerState();});
  await page.waitForTimeout(1800);
  current=await page.evaluate(()=>window.fixture.report());
  assert.equal(current.peers,initial.peers+2,"old peer connected event cannot cancel replacement retry");
  await page.evaluate(()=>window.fixture.unmount());
  initial=await setup();
  await page.evaluate(()=>{window.fixture.deferCandidate();window.fixture.failPeer();window.fixture.signal('ice_candidate',JSON.stringify({candidate:'old-candidate',sdpMid:'0',sdpMLineIndex:0}));});
  await page.waitForFunction(()=>window.fixture.report().candidatePending);
  await page.waitForFunction(count=>window.fixture.report().peers===count+1,initial.peers);
  await page.evaluate(()=>window.fixture.signal('ice_candidate',JSON.stringify({candidate:'new-candidate',sdpMid:'0',sdpMLineIndex:0})));
  await page.waitForTimeout(25);
  await page.evaluate(()=>window.fixture.finishCandidate());
  await page.waitForTimeout(25);
  await page.evaluate(()=>window.fixture.signal('answer',JSON.stringify({type:'answer',sdp:'replacement-answer'})));
  await page.waitForTimeout(50);
  current=await page.evaluate(()=>window.fixture.report());
  assert.ok(current.candidates.some(entry=>entry.candidate==='new-candidate' && entry.peer===current.peers-1),'old candidate completion cannot erase replacement ICE queue');
  await page.evaluate(()=>window.fixture.unmount());
  initial=await setup();
  for(let attempt=1;attempt<=4;attempt++){
    await page.evaluate(()=>window.fixture.failPeer());
    await page.waitForFunction(count=>window.fixture.report().peers===count,initial.peers+attempt,{timeout:6000});
  }
  await page.evaluate(()=>window.fixture.failPeer());
  await page.waitForTimeout(100);
  current=await page.evaluate(()=>window.fixture.report());
  assert.equal(current.state.terminalState,"failed","exhausted retry exposes terminal failure");
  assert.equal(current.state.localJoinedCallId,null,'exhausted retry releases local runtime');
  assert.equal(current.canJoin,true,'explicit return remains available');
  const exhaustedPeers=current.peers;
  await page.evaluate(()=>window.fixture.sync());await page.waitForTimeout(50);
  await page.evaluate(payload=>window.fixture.signal("ice_candidate",payload),cases[0][1]);
  await page.waitForTimeout(100);
  current=await page.evaluate(()=>window.fixture.report());
  assert.equal(current.peers,exhaustedPeers,"polling/signals cannot bypass exhausted budget");
  await page.evaluate(()=>window.fixture.join());
  await page.waitForFunction(()=>window.fixture.report().state.localJoinedCallId==='call-1');
  current=await page.evaluate(()=>window.fixture.report());
  assert.equal(current.state.localJoinedCallId,'call-1','explicit return may start a fresh budget');
  await page.evaluate(()=>window.fixture.unmount());
  await setup();
  await page.evaluate(()=>{window.fixture.deferConfiguration();window.fixture.failPeer();});
  await page.waitForFunction(()=>window.fixture.report().configurationPending);
  await page.evaluate(()=>window.fixture.changeScope());
  await page.waitForTimeout(25);
  await page.evaluate(()=>{window.fixture.nextCall();return window.fixture.start();});
  await page.evaluate(()=>window.fixture.sync());
  await page.waitForTimeout(50);
  const replacement=await page.evaluate(()=>window.fixture.report());
  await page.evaluate(()=>window.fixture.finishConfiguration());
  await page.waitForTimeout(100);
  current=await page.evaluate(()=>window.fixture.report());
  assert.equal(current.peers,replacement.peers,'old pending recovery configuration cannot recreate current peer');
  assert.equal(current.state.localJoinedCallId,'call-2');
  await page.evaluate(()=>window.fixture.unmount());
  console.log(JSON.stringify({browser:await browser.version(),lateSignals:3,connectedCancellation:true,stalePeerIsolation:true,exhaustedBudget:true,scope:"Actual React hook; fake PC/RPC/media, no network evidence"}));
} finally {await browser.close();await server.close();}
