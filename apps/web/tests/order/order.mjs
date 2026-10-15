import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const here=fileURLToPath(new URL('.',import.meta.url)),web=fileURLToPath(new URL('../../',import.meta.url));
const server=await createServer({configFile:false,root:here,resolve:{alias:[{find:/^react$/,replacement:web+'node_modules/react/index.js'},{find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'}]},plugins:[{name:'lane-fixture',enforce:'pre',resolveId(id,importer){if(id==='../gateway/runtime'&&importer?.includes('/src/'))return here+'gateway.js';}}],server:{host:'127.0.0.1',port:Number(process.env.ORDER_FIXTURE_PORT??25174),strictPort:true,fs:{allow:[web,here]}}});
await server.listen();const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
try {
 const evidence=[];
 for(const lane of ['direct','group'])for(const scenario of ['edit','tombstone','scope','reconnect','initialLoad','recovery','quietReplace']){
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]+'?lane='+lane);await page.waitForFunction(()=>window.fixture);
  if(scenario==='initialLoad')await page.evaluate(()=>{window.fixture.setHistory([['origin','1']]);window.fixture.hold();});
  await page.evaluate(()=>window.fixture.mount());
  if(scenario!=='initialLoad')await page.waitForFunction(()=>window.fixture.report().state?.status==='ready');
  else await page.waitForFunction(()=>window.fixture.report().pending.some(ids=>ids[0]==='origin'));
  await page.evaluate(()=>window.fixture.hold());
  if(scenario==='edit'||scenario==='tombstone'||scenario==='scope'){
   await page.evaluate(kind=>{window.fixture.send('origin','1');window.fixture.send('mutation','2',kind==='tombstone'?'tombstone':'edit','origin');},scenario);
   await page.waitForFunction(()=>window.fixture.report().pending.length===2);
   await page.evaluate(()=>window.fixture.release('mutation'));
   await page.waitForFunction(()=>window.fixture.report().state.items.some(item=>item.failureKind==='unresolved_target'));
   if(scenario==='scope'){
    await page.evaluate(()=>window.fixture.switchScope('scope-b'));
    await page.waitForFunction(()=>window.fixture.report().state.scope==='scope-b');
    await page.evaluate(()=>{window.fixture.release('origin');window.fixture.send('origin','1','content',null,'scope-b');});
    await page.waitForFunction(()=>window.fixture.report().pending.some(ids=>ids[0]==='origin'));
    await page.evaluate(()=>window.fixture.release('origin'));
    await page.waitForFunction(()=>window.fixture.report().state.items.some(item=>item.messageId==='origin'));
    const state=(await page.evaluate(()=>window.fixture.report())).state;
    assert.equal(state.items.length,1);assert.equal(state.items[0].text,'origin');assert.equal(state.scope,'scope-b');
   }else{
    await page.evaluate(()=>window.fixture.release('origin'));
    await page.waitForFunction(()=>window.fixture.report().state.items.some(item=>item.messageId==='origin'&&item.kind==='message'));
    const state=(await page.evaluate(()=>window.fixture.report())).state;
    assert.equal(state.items.length,1);assert.equal(state.items[0].text,scenario==='edit'?'mutation':null);
    assert.equal(state.items[0].isTombstone,scenario==='tombstone');assert.equal(state.items[0].lastAppliedServerSequence,'2');
   }
  }else if(scenario==='reconnect'){
   await page.evaluate(()=>window.fixture.send('origin','1'));await page.waitForFunction(()=>window.fixture.report().pending.length===1);
   await page.evaluate(()=>window.fixture.release('origin'));await page.waitForFunction(()=>window.fixture.report().state.items.length===1);
   await page.evaluate(()=>{window.fixture.setHistory([['origin','1']]);window.fixture.reconnect();});
   await page.waitForFunction(()=>window.fixture.report().pending.length===1);
   await page.evaluate(()=>window.fixture.send('newer','2','edit','origin'));await page.waitForFunction(()=>window.fixture.report().pending.length===2);
   await page.evaluate(()=>window.fixture.release('newer'));await page.waitForFunction(()=>window.fixture.report().state.items[0]?.text==='newer');
   await page.evaluate(()=>window.fixture.releaseLoad());
   await page.waitForTimeout(25);
   const state=(await page.evaluate(()=>window.fixture.report())).state;
   assert.equal(state.items[0].text,'newer');assert.equal(state.items[0].lastAppliedServerSequence,'2');
  }else if(scenario==='recovery'){
   await page.evaluate(()=>window.fixture.send('recovery-edit','2','edit','origin'));
   await page.waitForFunction(()=>window.fixture.report().pending.length===1);
   await page.evaluate(()=>window.fixture.release('recovery-edit'));
   await page.waitForFunction(()=>window.fixture.report().state.items[0]?.failureKind==='unresolved_target');
   await page.evaluate(()=>{window.fixture.setHistory([['origin','1'],['recovery-edit','2','edit','origin']]);window.fixture.reconnect();});
   await page.waitForFunction(()=>window.fixture.report().pending.length===1);
   await page.evaluate(()=>window.fixture.releaseLoad());
   await page.waitForFunction(()=>window.fixture.report().state.items[0]?.text==='recovery-edit');
   assert.equal((await page.evaluate(()=>window.fixture.report())).state.items.length,1);
  }else if(scenario==='quietReplace'){
   await page.evaluate(()=>window.fixture.send('origin','1'));await page.waitForFunction(()=>window.fixture.report().pending.length===1);
   await page.evaluate(()=>window.fixture.release('origin'));await page.waitForFunction(()=>window.fixture.report().state.items.length===1);
   await page.evaluate(()=>{window.fixture.clearBuffer();window.fixture.setHistory([]);window.fixture.reconnect();});
   await page.waitForFunction(()=>window.fixture.report().pending.length===1);
   await page.evaluate(()=>window.fixture.releaseLoad());await page.waitForFunction(()=>window.fixture.report().state.items.length===0);
  }else{
   await page.evaluate(()=>window.fixture.send('early-edit' ,'2','edit','origin'));await page.waitForFunction(()=>window.fixture.report().pending.length===2);
   await page.evaluate(()=>window.fixture.release('early-edit'));await page.waitForFunction(()=>window.fixture.report().state.items[0]?.failureKind==='unresolved_target');
   await page.evaluate(()=>window.fixture.releaseLoad());await page.waitForFunction(()=>window.fixture.report().state.items[0]?.text==='early-edit');
   assert.equal((await page.evaluate(()=>window.fixture.report())).state.items.length,1);
  }
  assert.deepEqual(errors,[]);evidence.push({lane,scenario,...await page.evaluate(()=>window.fixture.report())});
  await page.evaluate(()=>window.fixture.unmount());await page.close();
 }
 console.log(JSON.stringify({browser:await browser.version(),evidence,scope:'Production React lane hooks, projection and subscriptions; synthetic gateway/controlled decrypted payloads. No real-device/backend/crypto acceptance claim.'}));
}finally{await browser.close();await server.close();}
