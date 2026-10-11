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
  const page = await browser.newPage();
  const url = server.resolvedUrls.local[0];
  const results = [];
  for (const action of ["start", "join"]) {
    for (const cleanup of ["unmount", "changeScope"]) {
      for (const phase of ["capture", "mutation"]) {
        await page.goto(url);
        await page.waitForFunction(()=>window.fixture);
        await page.evaluate(()=>window.fixture.mount());
        await page.waitForFunction(()=>window.fixture.report().state.syncStatus==="ready");
        if(action==="join"){
          await page.evaluate(()=>window.fixture.sync());
          await page.waitForFunction(()=>window.fixture.report().state.call!==null);
        }
        await page.evaluate(phase=>window.fixture[phase==="capture"?"deferCapture":"deferMutation"](),phase);
        await page.evaluate(action=>{window.pending=window.fixture[action]();},action);
        await page.waitForFunction(phase=>phase==="capture"?window.fixture.report().captures===1:window.fixture.report().log.length===1,phase);
        await page.evaluate(cleanup=>window.fixture[cleanup](),cleanup);
        await page.waitForTimeout(50);
        await page.evaluate(phase=>window.fixture[phase==="capture"?"releaseCapture":"finishMutation"](),phase);
        await page.evaluate(()=>window.pending);
        await page.waitForTimeout(50);
        const result=await page.evaluate(()=>window.fixture.report());
        assert.equal(result.stops,phase==='capture'?2:1,`${action}/${cleanup}/${phase}: every captured track stopped`);
        assert.equal(result.peers,0,"stale operation must not create peer");
        assert.deepEqual(result.log,phase==="capture"?[]:[action,"leave"]);
        results.push({action,cleanup,phase,stops:result.stops,log:result.log});
        if(cleanup!=="unmount")await page.evaluate(()=>window.fixture.unmount());
      }
    }
  }
  for(const action of ['start','join']){
  for(const rejected of [true,false]){
    await page.goto(url);
    await page.waitForFunction(()=>window.fixture);
    await page.evaluate(()=>window.fixture.mount());
    await page.waitForFunction(()=>window.fixture.report().state.syncStatus==="ready");
    if(action==='join'){
      await page.evaluate(()=>window.fixture.sync());
      await page.waitForFunction(()=>window.fixture.report().state.call!==null);
    }
    await page.evaluate(()=>window.fixture.deferCapture());
    await page.evaluate(action=>{window.pending=Promise.all([window.fixture[action](),window.fixture[action]()]);},action);
    await page.waitForTimeout(25);
    const pending=await page.evaluate(()=>window.fixture.report());
    assert.equal(pending.captures,1,"double click captures once");
    await page.evaluate(rejected=>window.fixture[rejected?"rejectCapture":"releaseCapture"](),rejected);
    await page.evaluate(()=>window.pending);
    const result=await page.evaluate(()=>window.fixture.report());
    assert.deepEqual(result.log.filter(method=>method!=='heartbeat'),rejected?[]:[action]);
    if(rejected)assert.equal(result.log.length,0);
    assert.equal(result.state.actionState,"idle");
    if(rejected)assert.equal(result.state.mediaState,"denied");
    await page.evaluate(()=>window.fixture.unmount());
  }
  }
  console.log(JSON.stringify({browser:await browser.version(),results,scope:"Actual React; fake media/PC/RPC; no microphone/network evidence"}));
} finally {await browser.close();await server.close();}
