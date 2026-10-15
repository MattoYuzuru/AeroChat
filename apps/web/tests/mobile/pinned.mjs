import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import react from '@vitejs/plugin-react-swc';
process.umask(0o077);
const here=fileURLToPath(new URL('.',import.meta.url));
const web=path.resolve(process.env.PINNED_LAYOUT_SOURCE_ROOT??fileURLToPath(new URL('../../',import.meta.url)))+'/';
const repoRoot=fs.realpathSync(path.resolve(web,'../..'));
const artifact=process.env.PINNED_LAYOUT_ARTIFACT_DIR;assert.ok(artifact&&path.isAbsolute(artifact)&&fs.realpathSync(artifact)===path.resolve(artifact)&&fs.statSync(artifact).isDirectory()&&(fs.statSync(artifact).mode&0o077)===0);
const profile=path.join(artifact,'cft-profile');fs.mkdirSync(profile,{mode:0o700});
const executable=fs.realpathSync(process.env.CHROMIUM_EXECUTABLE);
const {createServer}=await import(pathToFileURL(web+'node_modules/vite/dist/node/index.js').href);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const port=Number(process.env.PINNED_LAYOUT_FIXTURE_PORT??25174);assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=['pages/ChatsPage.tsx','pages/ChatsPage.module.css','app/AppShell.tsx','app/AppShell.module.css'];
const source=Object.fromEntries(files.map(file=>[file,sha(web+'src/'+file)]));
const server=await createServer({configFile:false,root:here,plugins:[{name:'pinned-layout-fixture',enforce:'pre',resolveId(id,importer){if(importer?.endsWith('/AppShell.tsx')&&id==='../auth/useAuth')return here+'auth.js';if(importer?.endsWith('/AppShell.tsx')&&id==='../rtc/useDirectCallAwareness')return here+'rtc.js';if(importer?.endsWith('/harness.jsx')&&id.startsWith('../../src/'))return web+'src/'+id.slice('../../src/'.length);}},react()],resolve:{alias:[{find:/^react$/,replacement:web+'node_modules/react/index.js'},{find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'}]},server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[repoRoot,web,here]}}});
let context,ownedPids=[],interrupted=false;const cases=[],pageErrors=[],cleanupErrors=[];
const write=(name,value)=>{const fd=fs.openSync(path.join(artifact,name),'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Owned cleanup bound')),1500))]);
const processRows=()=>execFileSync('ps',['-ww','-axo','pid=,pgid=,command='],{encoding:'utf8',timeout:500}).split('\n').map(row=>row.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).map(row=>({pid:Number(row[1]),pgid:Number(row[2]),command:row[3]}));
const freshOwned=()=>processRows().filter(row=>row.command.startsWith(executable+' ')&&(row.command+' ').includes('--user-data-dir='+profile+' '));
const killOwned=()=>{for(const row of freshOwned()){assert.equal(row.pid,row.pgid);assert.notEqual(row.pgid,process.pid);try{process.kill(-row.pgid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}};
const onSignal=()=>{interrupted=true;process.exitCode=1;try{killOwned();}catch{cleanupErrors.push('owned-signal-cleanup');}server.httpServer?.close();};
process.on('SIGTERM',onSignal);process.on('SIGINT',onSignal);
const ownership={owned:true,nodePid:process.pid,profile,executable,executableSha256:sha(executable),port,source,phase:'prelaunch'};write('ownership.json',ownership);
const specs=[['direct',320,568,'tombstone'],['self',320,568,'tombstone'],['direct',390,844,'tombstone'],['direct',568,320,'tombstone'],['direct',390,844,'long'],['direct',768,1024,'long'],['direct',844,390,'long']];
const clipped=locator=>locator.evaluate(element=>{const r=element.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight;for(let p=element.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,b.left+p.clientLeft);right=Math.min(right,b.left+p.clientLeft+p.clientWidth);}if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,b.top+p.clientTop);bottom=Math.min(bottom,b.top+p.clientTop+p.clientHeight);}}return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,fullyVisible:r.left>=left-1&&r.right<=right+1&&r.top>=top-1&&r.bottom<=bottom+1};});
const tab=async(page,locator)=>{await page.getByRole('button',{name:'Назад к списку',exact:true}).focus();for(let n=0;n<80;n++){if(await locator.evaluate(e=>document.activeElement===e))return;await page.keyboard.press('Tab');}throw new Error('Natural Tab target unreachable');};
try{
 await server.listen();assert.equal(sha(executable),ownership.executableSha256);context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:executable,handleSIGTERM:false,handleSIGINT:false});
 ownedPids=freshOwned().map(row=>{assert.equal(row.pid,row.pgid);return {pid:row.pid,pgid:row.pgid,startTime:execFileSync('ps',['-p',String(row.pid),'-o','lstart='],{encoding:'utf8',timeout:500}).trim(),commandSha256:crypto.createHash('sha256').update(row.command).digest('hex')};});assert.equal(ownedPids.length,1);write('browser-pids.json',{owned:true,profile,executable,processes:ownedPids,browser:context.browser().version()});
 const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>pageErrors.push(error.name));const origin=server.resolvedUrls.local[0];await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort());
 for(const [lane,width,height,pin]of specs){
  if(interrupted)break;let phase='goto',geometry=null;const name=lane+'-'+width+'x'+height+'-'+pin,measurements=[];
  try{
   await page.setViewportSize({width,height});await page.goto(origin+'app/'+(lane==='self'?'self':'chats')+'?lane='+lane+'&count=50&state=normal&pin='+pin);await page.evaluate(()=>document.fonts.ready);
   const editor=page.getByRole('textbox');await editor.waitFor();await tab(page,editor);await page.keyboard.type('Синтетический черновик');
   for(const rotation of [false,true]){
    if(rotation){await page.setViewportSize({width:height,height:width});assert.equal(await editor.inputValue(),'Синтетический черновик');await tab(page,editor);}
    geometry=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};const h=document.querySelector('[data-testid=history]'),s=getComputedStyle(h);return {viewport:{width:innerWidth,height:innerHeight},composer:rect(document.querySelector('[data-testid=composer]')),history:rect(h),historyUsableHeight:h.clientHeight-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom),historyClientHeight:h.clientHeight,historyScrollHeight:h.scrollHeight,documentY:scrollY};});geometry.editor=await clipped(editor);measurements.push(geometry);
    phase='textarea-width';assert.ok(geometry.editor.width>=140);phase='textarea-height';assert.ok(geometry.editor.height>=39);phase='textarea-fully-visible';assert.ok(geometry.editor.fullyVisible);phase='history-useful-height';assert.ok(geometry.historyUsableHeight>=48-1);phase='history-composer-nonoverlap';assert.ok(geometry.history.bottom<=geometry.composer.y+1);phase='history-independent-scroll';assert.ok(geometry.historyScrollHeight>geometry.historyClientHeight);
    const scroll=await page.getByTestId('history').evaluate(element=>{const previous=element.scrollTop;element.scrollTop=previous>1?0:element.scrollHeight;return {previous,after:element.scrollTop,documentY:scrollY,composerY:document.querySelector('[data-testid=composer]').getBoundingClientRect().y};});assert.notEqual(scroll.previous,scroll.after);assert.equal(scroll.documentY,geometry.documentY);assert.equal(scroll.composerY,geometry.composer.y);
    phase='composer-and-pin-controls';for(const button of [...await page.getByTestId('composer').getByRole('button').all(),...await page.getByTestId('pinned').getByRole('button').all()]){if(!(await button.isEnabled()))continue;await tab(page,button);const b=await clipped(button);assert.ok(b.fullyVisible&&b.width>=32&&b.height>=32);}
    phase='pin-summary-preserved';assert.equal(await page.getByTestId('pinned').getByText(pin==='tombstone'?'Сообщение закреплено, но уже удалено для всех.':/Длинный preview/,{exact:pin==='tombstone'}).count(),1);assert.equal(await editor.inputValue(),'Синтетический черновик');
   }
   assert.deepEqual(pageErrors,[]);cases.push({name,status:'pass',measurements});
  }catch(error){cases.push({name,status:'fail',errorKind:error.name,failedPhase:phase,geometry,measurements});}
 }
}finally{
 if(context)try{await bounded(context.close());}catch{cleanupErrors.push('owned-browser-close');}try{killOwned();}catch{cleanupErrors.push('owned-force-close');}try{await bounded(server.close());}catch{cleanupErrors.push('owned-vite-close');}process.off('SIGTERM',onSignal);process.off('SIGINT',onSignal);
}
assert.equal(sha(executable),ownership.executableSha256);assert.deepEqual(Object.fromEntries(files.map(file=>[file,sha(web+'src/'+file)])),source);
const listenerClosed=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',()=>{socket.destroy();resolve(true);});socket.once('timeout',()=>{socket.destroy();resolve(false);});});
const ownedProcessesGone=processRows().every(row=>!(row.command+' ').includes('--user-data-dir='+profile+' ')&&!ownedPids.some(saved=>saved.pgid===row.pgid));const failures=cases.filter(row=>row.status==='fail').length;
const junit=process.env.PINNED_LAYOUT_JUNIT;assert.ok(junit&&path.isAbsolute(junit)&&path.dirname(junit)===artifact);fs.writeFileSync(junit,`<?xml version="1.0"?><testsuite name="faithful-pinned-mobile-composer" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${cases.map(row=>`<testcase classname="pinned-mobile-composer" name="${row.name}">${row.status==='fail'?`<failure message="${row.errorKind}:${row.failedPhase}"/>`:''}</testcase>`).join('')}</testsuite>\n`,{mode:0o600,flag:'wx'});
const evidence={status:cases.length===7&&!failures&&!cleanupErrors.length&&listenerClosed&&ownedProcessesGone&&!pageErrors.length&&!interrupted?'pass':'fail',sourceRoot:web,source,browserExecutable:executable,artifact,profile,ownedPids,cases,pageErrors,cleanupErrors,listenerClosed,ownedProcessesGone,interrupted,scope:'Production mobile CSS+LegacyAppShell and faithful pinned DOM; synthetic auth/RTC, no backend/browser core/native zoom/device acceptance'};write('evidence.json',evidence);process.stdout.write(JSON.stringify(evidence)+'\n');if(evidence.status!=='pass')process.exitCode=1;
