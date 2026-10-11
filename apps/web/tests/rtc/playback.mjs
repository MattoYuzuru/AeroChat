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
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(()=>window.fixture);
  await page.evaluate(()=>window.fixture.mount());
  await page.waitForFunction(()=>window.fixture.report().state.syncStatus==='ready');
  await page.evaluate(()=>window.fixture.start());
  await page.evaluate(()=>window.fixture.sync());
  await page.waitForTimeout(50);
  const initial = await page.evaluate(()=>window.fixture.report());
  await page.evaluate(()=>window.fixture.emitTrack());
  await page.waitForTimeout(100);
  let current = await page.evaluate(()=>window.fixture.report());
  assert.equal(current.plays,1);
  assert.equal(current.pauses,initial.pauses);
  for(let i=0;i<3;i++){
    await page.evaluate(()=>window.fixture.sync());
    await page.waitForTimeout(25);
  }
  current = await page.evaluate(()=>window.fixture.report());
  assert.equal(current.plays,1, 'participant refresh must preserve playback');
  assert.equal(current.pauses,initial.pauses);
  await page.evaluate(()=>{window.fixture.block(true);window.fixture.emitTrack();});
  await page.waitForTimeout(100);
  current = await page.evaluate(()=>window.fixture.report());
  assert.equal(current.plays,2);
  assert.equal(current.pauses,initial.pauses+1);
  assert.equal(current.state.remoteAudioState,'blocked');
  await page.evaluate(()=>{window.fixture.block(false);return window.fixture.retry();});
  await page.waitForTimeout(50);
  current = await page.evaluate(()=>window.fixture.report());
  assert.equal(current.plays,3);
  assert.equal(current.pauses,initial.pauses+1);
  assert.equal(current.state.remoteAudioState,'ready');
  await page.evaluate(()=>window.fixture.unmount());
  current = await page.evaluate(()=>window.fixture.report());
  assert.equal(current.attached,false);
  assert.equal(current.pauses,initial.pauses+2);
  console.log(JSON.stringify({browser:await browser.version(),plays:current.plays,pauses:current.pauses,scope:'Actual React hook and exact ChatsPage playback effect; fake audio/PC/RPC; no real media/network evidence'}));
} finally {await browser.close();await server.close();}
