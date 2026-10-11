import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const here=fileURLToPath(new URL('.',import.meta.url));
const web=fileURLToPath(new URL('../../',import.meta.url));
const server=await createServer({configFile:false,root:here,resolve:{alias:[
  {find:/^react$/,replacement:web+'node_modules/react/index.js'},
  {find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'},
]},plugins:[{name:'lobby-fixture',enforce:'pre',resolveId(source,importer){if(importer?.endsWith('/rtc/useGroupLobbyHeartbeat.ts')&&source==='../gateway/runtime')return here+'gateway.js';}}],server:{host:'127.0.0.1',port:Number(process.env.RTC_FIXTURE_PORT??25173),strictPort:true,fs:{allow:[web,here]}}});
await server.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
try {
  const page=await browser.newPage();
  await page.clock.install();
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(()=>window.lobby);
  await page.evaluate(()=>window.lobby.mount());
  await page.clock.runFor(180_000);
  assert.equal((await page.evaluate(()=>window.lobby.report())).touches.length,0,'observer cannot extend foreign participation');
  await page.evaluate(()=>window.lobby.join());
  await page.clock.runFor(180_000);
  let result=await page.evaluate(()=>window.lobby.report());
  assert.equal(result.touches.length,10,'joined lobby sends immediate and 20 second touches');
  await page.evaluate(()=>window.lobby.visibility(false));
  await page.clock.runFor(180_000);
  assert.equal((await page.evaluate(()=>window.lobby.report())).touches.length,10,'hidden page stops heartbeat');
  await page.evaluate(()=>window.lobby.visibility(true));
  await page.clock.runFor(1);
  assert.equal((await page.evaluate(()=>window.lobby.report())).touches.length,11);
  await page.evaluate(()=>window.lobby.reader());
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
  console.log(JSON.stringify({browser:await browser.version(),...result,scope:'Actual React hook and ownership selector; accelerated browser clock; fake RTC RPC; server liveness verified separately by real PostgreSQL test'}));
} finally {await browser.close();await server.close();}
