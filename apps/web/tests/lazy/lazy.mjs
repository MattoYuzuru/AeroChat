import {lazyModuleUrls} from "../../build/lazy-module-urls.mjs";
import assert from 'node:assert/strict';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import react from '@vitejs/plugin-react-swc';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const here=fileURLToPath(new URL('.',import.meta.url)),web=fileURLToPath(new URL('../../',import.meta.url));
const source=process.env.LAZY_SOURCE_ROOT??web,baseline=process.env.LAZY_BASELINE==='1';
const output=process.env.LAZY_BUILD_DIR;
assert.ok(output,'External owned build directory is required');
const result=await build({configFile:false,root:here,plugins:[{name:'lazy-fixture',enforce:'pre',resolveId(id,importer){
 if(importer?.endsWith('/harness.jsx')&&id.startsWith('../../src/'))return source+'src/'+id.slice('../../src/'.length);
 if(id.endsWith('/auth/useAuth')||id==='../auth/useAuth')return here+'auth.js';
 if(id.endsWith('/gateway/runtime')||id==='../gateway/runtime')return here+'gateway.js';
 if(id.endsWith('/rtc/useDirectCallAwareness')||id==='../rtc/useDirectCallAwareness')return here+'rtc.js';
 if(id.endsWith('/realtime/events')||id==='../realtime/events')return here+'realtime.js';
},transform(code,id){const probe=['/react/index.js','/auth/AuthContext.tsx','/crypto/context.tsx','/notifications/context.tsx','/rtc/context.tsx'].find(suffix=>id.endsWith(suffix));if(probe)return {code:`globalThis.__lazyExecutions??={};globalThis.__lazyExecutions[${JSON.stringify(probe)}]=(globalThis.__lazyExecutions[${JSON.stringify(probe)}]??0)+1;\n`+code,map:null};}},react(),lazyModuleUrls(source+"src/")],resolve:{alias:[{find:/^react$/,replacement:web+'node_modules/react/index.js'},{find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'}]},build:{outDir:output,emptyOutDir:false,manifest:true}});
const manifest=JSON.parse(await readFile(output+'/.vite/manifest.json','utf8'));
const chunks=(Array.isArray(result)?result.flatMap(item=>item.output):result.output).filter(item=>item.type==='chunk');
const entry=chunks.find(item=>item.isEntry);
const closure=new Set();function visit(file){if(closure.has(file))return;closure.add(file);for(const dependency of chunks.find(item=>item.fileName===file)?.imports??[])visit(dependency);}visit(entry.fileName);
const eagerModules=chunks.filter(item=>closure.has(item.fileName)).flatMap(item=>item.moduleIds);
const heavyNames=['DesktopShell','AppShell','MobileLauncherHome','PeoplePage','ExplorerPage','ChatsPage','GroupsPage'];
for(const name of heavyNames)assert.equal(eagerModules.some(id=>id.endsWith('/'+name+'.tsx')),baseline,'static entry closure '+name);
const chunk=name=>{const entry=Object.entries(manifest).find(([key])=>key.endsWith('/'+name+'.tsx'));assert.ok(entry,name+' chunk');return '/'+entry[1].file;};
const server=createServer(async(request,response)=>{
 const pathname=new URL(request.url,'http://127.0.0.1').pathname;
 const path=pathname.startsWith('/assets/')?pathname:'/index.html';
 try{const bytes=await readFile(output+path);response.setHeader('Cache-Control','no-store');response.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.woff2')?'font/woff2':path.endsWith('.json')?'application/json':'text/html');response.end(bytes);}catch{response.statusCode=404;response.end();}
});
let browser;const diagnostic={stage:'setup',requests:[],failedRequests:[],pageErrors:[],attempts:0};
const waterfall=[],sizeTasks=[];
function trackWaterfall(page,label){
 page.on('pageerror',error=>diagnostic.pageErrors.push({label,name:error.name,message:error.message.slice(0,300)}));
 const records=new Map();
 page.on('request',request=>{const record={label,stage:diagnostic.stage,path:new URL(request.url()).pathname,query:new URL(request.url()).search,type:request.resourceType(),issuedAt:Date.now()};records.set(request,record);waterfall.push(record);});
 page.on('response',response=>{const record=records.get(response.request());if(record)record.status=response.status();});
 page.on('requestfinished',request=>{const record=records.get(request);if(!record)return;record.timing=request.timing();sizeTasks.push(request.sizes().then(sizes=>{record.sizes=sizes;}).catch(()=>{record.sizesUnavailable=true;}));});
 page.on('requestfailed',request=>{const record=records.get(request);if(record){record.error=request.failure()?.errorText;record.timing=request.timing();}});
}
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(25174,'127.0.0.1',resolve);});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
 const page=await browser.newPage({viewport:{width:1366,height:900}});trackWaterfall(page,baseline?'parent-login':'window-retry');const requests=diagnostic.requests;page.on('request',request=>requests.push(new URL(request.url()).pathname));page.on('requestfailed',request=>diagnostic.failedRequests.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText}));diagnostic.stage='login';
 await page.goto('http://127.0.0.1:25174/login');await page.getByRole('textbox',{name:'Логин',exact:true}).waitFor();
 if(baseline){
  console.log(JSON.stringify({baseline:true,source,entryBytes:(await stat(output+'/'+entry.fileName)).size,eagerHeavyModules:heavyNames,requests,scope:'Parent production AppRouter static entry closure and login network; synthetic auth/gateway/RTC/realtime'}));
 }else{
 for(const name of ['DesktopShell','AppShell','MobileLauncherHome','PeoplePage','ExplorerPage','ChatsPage','GroupsPage'])assert.equal(requests.includes(chunk(name)),false,'login does not fetch '+name);
 await page.getByRole('textbox',{name:'Логин',exact:true}).fill('owned.fixture');await page.getByLabel('Пароль',{exact:true}).fill('owned-fixture-password');await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('region',{name:'Рабочий стол AeroChat'}).waitFor();
 assert.equal(requests.includes(chunk('DesktopShell')),true);assert.equal(requests.includes(chunk('PeoplePage')),false);
 const icon=title=>page.locator('[data-desktop-entry=true]').filter({hasText:title});
 await icon('Люди').focus();await page.keyboard.press('Enter');const draft=page.getByRole('textbox',{name:'Точный login',exact:true});await draft.waitFor();await draft.fill('Непотерянный черновик');
 const explorerPath=chunk('ExplorerPage');let attempts=0,releaseRetry;
 const retryResponse=new Promise(resolve=>{releaseRetry=resolve;});
 await page.route(url=>url.pathname===explorerPath,async route=>{attempts++;diagnostic.attempts=attempts;if(attempts===1)await route.abort('failed');else{await retryResponse;await route.continue();}});
 diagnostic.stage='window-chunk-failure';
 await icon('Проводник').focus();await page.keyboard.press('Enter');const error=page.getByRole('alert');await error.getByRole('button',{name:'Повторить загрузку',exact:true}).waitFor();assert.equal(await draft.inputValue(),'Непотерянный черновик');
 const retry=error.getByRole('button',{name:'Повторить загрузку',exact:true});assert.equal(await retry.evaluate(element=>document.activeElement===element),true,'failed active window focuses retry');
 await page.screenshot({path:output+'/failed-window.png'});
 const retriedRequest=page.waitForRequest(request=>new URL(request.url()).pathname===explorerPath&&new URL(request.url()).searchParams.get('aerochat_retry')==='1');
 await retry.evaluate(element=>{element.click();element.click();});
 diagnostic.stage='window-chunk-retry';
 await retriedRequest;const retryStatus=page.getByRole('status');await retryStatus.waitFor();assert.equal(await retryStatus.evaluate(element=>document.activeElement===element),true,'pending retry keeps active-window keyboard focus');assert.equal(await draft.inputValue(),'Непотерянный черновик');releaseRetry();
 await page.getByPlaceholder('Новая папка',{exact:true}).waitFor();assert.equal(attempts,2,'one retry fetch after two immediate clicks');assert.equal(await draft.inputValue(),'Непотерянный черновик');
 const delayedPath=chunk('CreateGroupPage');let release;
 diagnostic.stage='close-before-late-chunk';
 const delayed=new Promise(resolve=>{release=resolve;});
 await page.route('**'+delayedPath,async route=>{await delayed;await route.continue();});
 const started=page.waitForRequest('**'+delayedPath);
 await icon('Создать группу').focus();await page.keyboard.press('Enter');await started;await page.getByRole('status').waitFor();
 const titleBar=page.getByRole('button',{name:'Окно Создать группу',exact:true});
 await titleBar.locator('xpath=../..').getByRole('button',{name:'Закрыть',exact:true}).click();await titleBar.waitFor({state:'hidden'});
 const completed=page.waitForResponse('**'+delayedPath);release();await completed;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await titleBar.count(),0,'late chunk does not reopen closed window');assert.equal(await draft.inputValue(),'Непотерянный черновик');
 const surfaceEvidence=[];
 for(const [width,height,name,target]of [[1366,900,'DesktopShell','Рабочий стол AeroChat'],[390,844,'AppShell','Быстрый вход в AeroChat'],[390,844,'MobileLauncherHome','Быстрый вход в AeroChat']]){
  diagnostic.stage='surface-retry-'+name;
  const surface=await browser.newPage({viewport:{width,height}});let count=0;const surfacePath=chunk(name);
  trackWaterfall(surface,name);
  await surface.route(url=>url.pathname===surfacePath,async route=>{count++;if(count===1)await route.abort('failed');else await route.continue();});
  await surface.goto('http://127.0.0.1:25174/login');await surface.getByRole('textbox',{name:'Логин',exact:true}).fill('owned.fixture');await surface.getByLabel('Пароль',{exact:true}).fill('owned-fixture-password');await surface.getByRole('button',{name:'Войти',exact:true}).click();
  const retry=surface.getByRole('alert').getByRole('button',{name:'Повторить загрузку',exact:true});await retry.waitFor();assert.equal(await retry.evaluate(element=>document.activeElement===element),true);
  await surface.keyboard.press('Enter');await surface.getByRole(width===1366?'region':'heading',{name:target,exact:true}).waitFor();assert.equal(count,2,name+' recovered with one retry');surfaceEvidence.push({name,width,height,attempts:count});await surface.close();
 }
 await verifyPair();

 async function verifyPair(){
  const explorerPath=chunk('ExplorerPage');
  const cssPath='/'+Object.entries(manifest).find(([key])=>key.endsWith('/ExplorerPage.tsx'))[1].css[0];
  for(const mode of ['concurrent','css','exhaustion','invalid-sidecar','oversized-sidecar','external-css','sidecar-redirect']){
   diagnostic.stage='pair-'+mode;
   const pair=await browser.newPage();trackWaterfall(pair,mode);
   let jsAttempts=0,cssAttempts=0,sidecars=0,release;
   const held=new Promise(resolve=>{release=resolve;});
   await pair.route(url=>url.pathname===explorerPath,async route=>{
    jsAttempts++;
    if(mode==='css'){await route.continue();return;}
    if(jsAttempts===1||mode==='exhaustion'){await route.abort('failed');return;}
    if(mode==='concurrent')await held;
    await route.continue();
   });
   if(mode==='css')await pair.route(url=>url.pathname===cssPath,async route=>{cssAttempts++;if(cssAttempts===1)await route.abort('failed');else await route.continue();});
   await pair.route(url=>url.pathname===explorerPath+'.resources.json',async route=>{
    sidecars++;
    if(sidecars===1&&mode==='invalid-sidecar')await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({module:'wrong.js',css:[]})});else if(sidecars===1&&mode==='oversized-sidecar')await route.fulfill({status:200,contentType:'application/json',body:' '.repeat(16385)});else if(sidecars===1&&mode==='external-css')await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({module:explorerPath.split('/').at(-1),css:['http://127.0.0.1:25175/unowned.css']})});else if(sidecars===1&&mode==='sidecar-redirect')await route.fulfill({status:302,headers:{location:'/assets/unexpected.resources.json'}});else await route.continue();
   });
   await pair.goto('http://127.0.0.1:25174/retry-pair');
   const errors=pair.getByRole('alert');await errors.nth(1).waitFor();
   const draft=pair.getByRole('textbox',{name:'Соседний черновик',exact:true});await draft.fill('Сохранён при двух ошибках');
   const first=pair.locator('[data-pair="0"]'),second=pair.locator('[data-pair="1"]');
   if(mode==='exhaustion'){
    for(let attempt=1;attempt<=3;attempt++){
     const request=pair.waitForRequest(request=>new URL(request.url()).pathname===explorerPath&&new URL(request.url()).searchParams.get('aerochat_retry')===String(attempt));
     await first.getByRole('button',{name:'Повторить загрузку',exact:true}).click();await request;await first.getByRole('alert').waitFor();
    }
    assert.equal(jsAttempts,4);assert.equal(sidecars,3);assert.equal(await first.getByRole('button',{name:'Повторить загрузку',exact:true}).isDisabled(),true);assert.equal(await second.getByRole('button',{name:'Повторить загрузку',exact:true}).isDisabled(),true,'all failed instances receive shared exhaustion');assert.equal(await second.getByText('Повторные попытки исчерпаны.',{exact:false}).count(),1);
    await pair.getByRole('button',{name:'Переключить окна',exact:true}).click();await first.waitFor({state:'detached'});await pair.getByRole('button',{name:'Переключить окна',exact:true}).click();await first.getByRole('alert').waitFor();assert.equal(await first.getByRole('button',{name:'Повторить загрузку',exact:true}).isDisabled(),true);assert.equal(jsAttempts,4,'reopen cannot reset lifetime budget');
   }else{
    await first.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
    if(['invalid-sidecar','oversized-sidecar','external-css','sidecar-redirect'].includes(mode)){
     await first.getByRole('alert').waitFor();assert.equal(jsAttempts,1,'wrong module sidecar never imports');await first.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
    }
    if(mode==='concurrent'){
     await first.getByRole('status').waitFor();await second.getByRole('button',{name:'Повторить загрузку',exact:true}).click();await second.getByRole('status').waitFor();assert.equal(sidecars,1,'two failed instances share metadata/import');release();
    }
    await first.getByPlaceholder('Новая папка',{exact:true}).waitFor();
    if(mode!=='concurrent'){await second.getByRole('button',{name:'Повторить загрузку',exact:true}).click();}
    await second.getByPlaceholder('Новая папка',{exact:true}).waitFor();
    if(mode==='css'){assert.equal(cssAttempts,2);assert.equal(await pair.evaluate(path=>[...document.querySelectorAll('link[rel=stylesheet]')].some(link=>new URL(link.href).pathname===path&&link.sheet!==null),cssPath),true,'CSS retry finished before content');}
    const requestsBefore=jsAttempts;
    await pair.getByRole('button',{name:'Переключить окна',exact:true}).click();await first.waitFor({state:'detached'});const canonical=await pair.evaluate(()=>{window.__savedCanonical=window.__lazyCanonical;return true;});assert.equal(canonical,true);
    await pair.getByRole('button',{name:'Переключить окна',exact:true}).click();await second.getByPlaceholder('Новая папка',{exact:true}).waitFor();assert.equal(await pair.evaluate(()=>window.__savedCanonical===window.__lazyCanonical),true,'reopen retains recovered component identity');assert.equal(jsAttempts,requestsBefore,'reopen uses successful module cache');
   }
   assert.equal(await draft.inputValue(),'Сохранён при двух ошибках');
   console.log(JSON.stringify({pairMode:mode,jsAttempts,cssAttempts,sidecars}));await pair.close();
  }
 }
 const executions=await page.evaluate(()=>globalThis.__lazyExecutions);assert.ok(executions['/react/index.js']);for(const [module,count]of Object.entries(executions))assert.equal(count,1,'single shared module evaluation '+module);assert.equal(await page.evaluate(()=>globalThis.__lazyRootMounts),1,'retry does not execute root bootstrap again');
 const bytes=(await stat(output+'/'+entry.fileName)).size;
 console.log(JSON.stringify({browser:await browser.version(),entryBytes:bytes,requests,attempts,surfaceEvidence,sharedModuleExecutions:executions,rootBootstrapExecutions:1,lateChunkClose:true,scope:'Built production AppRouter/DesktopShell/lazy descriptors and real People/Explorer pages; synthetic auth/gateway/RTC/realtime only; no real account/crypto bootstrap claim'}));
 }
}catch(error){for(const [index,page]of (browser?.contexts().flatMap(context=>context.pages())??[]).entries())try{await page.screenshot({path:output+'/failure-'+index+'.png'});}catch{}console.log(JSON.stringify({diagnostic}));throw error;}finally{
 try{await Promise.all(sizeTasks);await writeFile(output+'/network-waterfall.json',JSON.stringify({diagnostic,waterfall,scope:'Owned compiled fixture requests/timing/response sizes only; synthetic dependencies; no startup/device/crypto claim'},null,2)+'\n');}
 finally{await browser?.close();if(server.listening)await new Promise(resolve=>server.close(resolve));}
}
