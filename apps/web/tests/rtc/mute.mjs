import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const here=fileURLToPath(new URL('.',import.meta.url));
const web=fileURLToPath(new URL('../../',import.meta.url));
const source=await readFile(web+'src/pages/ChatsPage.tsx','utf8');
const start=source.indexOf('  useEffect(() => {\n    const audioElement = directCallAudioRef.current;');
const closing='  }, [directCallRemoteAudioStream, retryDirectCallRemoteAudioPlayback]);';
const end=source.indexOf(closing,start);
assert.ok(start>=0&&end>=start,'Actual ChatsPage playback effect must be found');
const effect=source.slice(start,end+closing.length);
const server=await createServer({configFile:false,root:here,resolve:{alias:[
  {find:/^react$/,replacement:web+'node_modules/react/index.js'},
  {find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'},
]},plugins:[{name:'rtc-mute-fixture',enforce:'pre',resolveId(id,importer){
  if(id==='virtual:playback')return '\0playback';
  if(importer?.endsWith('/rtc/useDirectCallSession.ts')){
    if(id==='../gateway/runtime')return here+'gateway.js';
    if(id==='../realtime/events')return here+'realtime.js';
  }
},load(id){if(id==='\0playback')return `import {useEffect} from 'react';export function usePlayback({directCallAudioRef,directCallRemoteAudioStream,retryDirectCallRemoteAudioPlayback}){${effect}}`;}}],server:{host:'127.0.0.1',port:Number(process.env.RTC_FIXTURE_PORT??25173),strictPort:true,fs:{allow:[web,here]}}});
let browser;
const evidence=[];
try{
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
  const page=await browser.newPage();
  page.setDefaultTimeout(8000);
  const url=server.resolvedUrls.local[0];
  const report=()=>page.evaluate(()=>window.fixture.report());
  async function mount(){
    await page.goto(url);await page.waitForFunction(()=>window.fixture);
    await page.evaluate(()=>window.fixture.mount());
    await page.waitForFunction(()=>window.fixture.report().state.syncStatus==='ready');
  }
  async function joined(){
    await mount();await page.evaluate(()=>window.fixture.start());await page.evaluate(()=>window.fixture.sync());
    await page.getByRole('button',{name:'Выключить микрофон',exact:true}).waitFor();
    await page.evaluate(()=>window.fixture.connect());
    await page.waitForFunction(()=>window.fixture.report().state.peerConnectionState==='connected');
    return report();
  }
  await mount();await page.evaluate(()=>window.fixture.toggleMicrophone());
  assert.equal((await report()).isMicrophoneMuted,false);
  assert.equal(await page.getByRole('button',{name:/микрофон/}).count(),0,'No control before local join');
  await page.evaluate(()=>{window.fixture.deferCapture();window.pending=window.fixture.start();});
  await page.waitForFunction(()=>window.fixture.report().captures===1);
  await page.evaluate(()=>window.fixture.toggleMicrophone());
  assert.equal((await report()).isMicrophoneMuted,false,'Pending capture does not accept mute');
  assert.equal(await page.getByRole('button',{name:/микрофон/}).count(),0);
  await page.evaluate(()=>window.fixture.releaseCapture());await page.evaluate(()=>window.pending);
  await page.evaluate(()=>window.fixture.unmount());evidence.push('prejoin and pending capture guards');

  let initial=await joined();
  let button=page.getByRole('button',{name:'Выключить микрофон',exact:true});
  assert.equal(await button.getAttribute('aria-pressed'),null,'Changing action label is an ordinary button');
  await button.focus();await page.keyboard.press('Enter');
  button=page.getByRole('button',{name:'Включить микрофон',exact:true});await button.waitFor();
  let current=await report();assert.equal(current.isMicrophoneMuted,true);assert.equal(current.trackEnabled,false);
  assert.equal(await button.getAttribute('aria-pressed'),null);
  assert.equal(current.captures,initial.captures);assert.equal(current.peers,initial.peers);
  await button.click();await page.waitForFunction(()=>!window.fixture.report().isMicrophoneMuted);
  assert.equal((await report()).trackEnabled,true);
  await page.evaluate(()=>{window.fixture.toggleMicrophone();window.fixture.toggleMicrophone();});
  await page.waitForFunction(()=>!window.fixture.report().isMicrophoneMuted);
  assert.equal((await report()).trackEnabled,true,'Rapid toggles use current owned state');
  await page.getByRole('button',{name:'Выключить микрофон',exact:true}).click();
  await page.waitForFunction(()=>window.fixture.report().isMicrophoneMuted);
  await page.evaluate(()=>window.fixture.failPeer());
  await page.waitForFunction(count=>window.fixture.report().peers===count+1,initial.peers);
  current=await report();assert.equal(current.isMicrophoneMuted,true);assert.equal(current.trackEnabled,false);
  assert.equal(current.captures,initial.captures,'Peer recovery does not recapture');
  await page.evaluate(()=>window.fixture.connect());
  await page.getByRole('button',{name:'Включить микрофон',exact:true}).click();
  await page.waitForFunction(()=>!window.fixture.report().isMicrophoneMuted);
  assert.equal((await report()).trackEnabled,true);
  await page.evaluate(()=>window.fixture.unmount());evidence.push('keyboard toggle, rapid toggle, same-runtime recovery');

  for(const cleanup of ['leave','end','changeScope','refreshAccount','changeToken','changeAccountOnly']){
    initial=await joined();await page.getByRole('button',{name:'Выключить микрофон',exact:true}).click();
    await page.waitForFunction(()=>window.fixture.report().isMicrophoneMuted);
    await page.evaluate(cleanup=>window.fixture[cleanup](),cleanup);
    await page.waitForFunction(()=>!window.fixture.report().isMicrophoneMuted&&window.fixture.report().state.localJoinedCallId===null);
    current=await report();assert.ok(current.stops>initial.stops,'Full release stops own capture');
    assert.equal(await page.getByRole('button',{name:/микрофон/}).count(),0);
    if(cleanup==='leave'){
      await page.evaluate(()=>window.fixture.sync());
      await page.waitForFunction(()=>window.fixture.report().canJoin);
      await page.evaluate(()=>window.fixture.join());
      await page.getByRole('button',{name:'Выключить микрофон',exact:true}).waitFor();
      current=await report();assert.equal(current.isMicrophoneMuted,false);assert.equal(current.trackEnabled,true);
    }
    await page.evaluate(()=>window.fixture.unmount());evidence.push({cleanup,case:'release reset and explicit rejoin'});
  }
  await joined();await page.evaluate(()=>window.fixture.endCapture());
  await page.waitForFunction(()=>!window.fixture.report().canToggleMicrophone);
  assert.equal(await page.getByRole('button',{name:'Выключить микрофон',exact:true}).isDisabled(),true,'Ended track disables the action');
  await page.evaluate(()=>window.fixture.toggleMicrophone());
  current=await report();assert.equal(current.isMicrophoneMuted,false,'Ended capture is not toggled');
  await page.evaluate(()=>window.fixture.unmount());evidence.push('ended track guard');
  await joined();await page.getByRole('button',{name:'Выключить микрофон',exact:true}).click();
  await page.waitForFunction(()=>window.fixture.report().isMicrophoneMuted);
  await page.evaluate(()=>{window.fixture.unmount();window.fixture.mount();});
  await page.waitForFunction(()=>window.fixture.report().state.syncStatus==='ready');
  assert.equal((await report()).isMicrophoneMuted,false,'Remount does not inherit old microphone preference');
  await page.evaluate(()=>window.fixture.unmount());evidence.push('unmount/remount reset');
  console.log(JSON.stringify({browser:await browser.version(),cases:evidence.length,evidence,scope:'Actual React controller and production microphone button; synthetic capture/PC/RPC, no acoustic/device/network proof'}));
}finally{try{await browser?.close();}finally{await server.close();}}
