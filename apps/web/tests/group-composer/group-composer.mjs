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
const files=['pages/GroupsPage.tsx','pages/GroupsPage.module.css','app/AppShell.tsx','app/AppShell.module.css','chats/ChatGlyph.tsx','attachments/metadata.ts','chats/DirectComposerFeedback.tsx'];
const source=Object.fromEntries(files.map(file=>[file,sha(web+'src/'+file)]));
const server=await createServer({configFile:false,root:here,plugins:[{name:'pinned-layout-fixture',enforce:'pre',resolveId(id,importer){if(importer?.endsWith('/AppShell.tsx')&&id==='../auth/useAuth')return web+'tests/mobile/auth.js';if(importer?.endsWith('/AppShell.tsx')&&id==='../rtc/useDirectCallAwareness')return web+'tests/mobile/rtc.js';if(importer?.endsWith('/harness.jsx')&&id.startsWith('../../src/'))return web+'src/'+id.slice('../../src/'.length);}},react()],resolve:{alias:[{find:/^react$/,replacement:web+'node_modules/react/index.js'},{find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'}]},server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[repoRoot,web,here]}}});
let context,ownedPids=[],interrupted=false;const cases=[],pageErrors=[],cleanupErrors=[];
const write=(name,value)=>{const fd=fs.openSync(path.join(artifact,name),'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Owned cleanup bound')),1500))]);
const processRows=()=>execFileSync('ps',['-ww','-axo','pid=,pgid=,command='],{encoding:'utf8',timeout:500}).split('\n').map(row=>row.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).map(row=>({pid:Number(row[1]),pgid:Number(row[2]),command:row[3]}));
const freshOwned=()=>processRows().filter(row=>row.command.startsWith(executable+' ')&&(row.command+' ').includes('--user-data-dir='+profile+' '));
const killOwned=()=>{for(const row of freshOwned()){assert.equal(row.pid,row.pgid);assert.notEqual(row.pgid,process.pid);try{process.kill(-row.pgid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}};
const onSignal=()=>{interrupted=true;process.exitCode=1;try{killOwned();}catch{cleanupErrors.push('owned-signal-cleanup');}server.httpServer?.close();};
process.on('SIGTERM',onSignal);process.on('SIGINT',onSignal);
const ownership={owned:true,nodePid:process.pid,profile,executable,executableSha256:sha(executable),port,source,phase:'prelaunch'};write('ownership.json',ownership);
const specs=[['group',320,568]];const sizes=[[320,568],[568,320]];
const clipped=locator=>locator.evaluate(element=>{const r=element.getBoundingClientRect();let left=0,top=0,right=innerWidth,bottom=innerHeight;for(let p=element.parentElement;p;p=p.parentElement){const s=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(s.overflowX)){left=Math.max(left,b.left+p.clientLeft);right=Math.min(right,b.left+p.clientLeft+p.clientWidth);}if(/auto|scroll|hidden|clip/.test(s.overflowY)){top=Math.max(top,b.top+p.clientTop);bottom=Math.min(bottom,b.top+p.clientTop+p.clientHeight);}}return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,clip:{left,top,right,bottom},fullyVisible:r.left>=left-1&&r.right<=right+1&&r.top>=top-1&&r.bottom<=bottom+1};});
const tab=async(page,locator)=>{await page.getByRole('textbox').focus();for(let n=0;n<160;n++){if(await locator.evaluate(e=>document.activeElement===e))return;await page.keyboard.press('Tab');}throw new Error('Natural Tab target unreachable');};
try{
 await server.listen();assert.equal(sha(executable),ownership.executableSha256);context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:executable,handleSIGTERM:false,handleSIGINT:false});
 ownedPids=freshOwned().map(row=>{assert.equal(row.pid,row.pgid);return {pid:row.pid,pgid:row.pgid,startTime:execFileSync('ps',['-p',String(row.pid),'-o','lstart='],{encoding:'utf8',timeout:500}).trim(),commandSha256:crypto.createHash('sha256').update(row.command).digest('hex')};});assert.equal(ownedPids.length,1);write('browser-pids.json',{owned:true,profile,executable,processes:ownedPids,browser:context.browser().version()});
 const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>pageErrors.push(error.name));const origin=server.resolvedUrls.local[0];await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort());
 for(const [lane,width,height]of specs){
  if(interrupted)break;let phase='goto',geometry=null;const name='group-reply-attachment-send-error-portrait-to-landscape',measurements=[];
  try{
   await page.setViewportSize({width,height});await page.goto(origin+'app/groups');await page.evaluate(()=>document.fonts.ready);
   const editor=page.getByRole('textbox');await editor.waitFor();const draft='Owned layout draft group';
   phase='reply-selection';await page.getByRole('button',{name:'Ответить',exact:true}).last().click();
   phase='attachment-ready';await page.locator('input[type=file]').setInputFiles({name:'owned-file.txt',mimeType:'text/plain',buffer:Buffer.alloc(93)});await page.getByText('Файл готов к отправке.',{exact:true}).waitFor();
   phase='synthetic-send-error';await editor.fill(draft);await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();await page.getByTestId('composer').locator('form > div').filter({hasText:/^Owned localhost layout failure\./}).waitFor();assert.equal(await page.getByTestId('composer').getAttribute('data-send-attempts'),'1');assert.equal(await editor.inputValue(),draft);
   for(const [viewportWidth,viewportHeight]of sizes){
    phase='viewport-focus';await page.setViewportSize({width:viewportWidth,height:viewportHeight});await editor.focus();
    geometry=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};const h=document.querySelector('[data-testid=history]'),s=getComputedStyle(h);return {viewport:{width:innerWidth,height:innerHeight},composer:rect(document.querySelector('[data-testid=composer]')),history:rect(h),historyUsableHeight:h.clientHeight-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom),historyClientHeight:h.clientHeight,historyScrollHeight:h.scrollHeight,documentY:scrollY};});geometry.editor=await clipped(editor);geometry.ancestors=await editor.evaluate(element=>{
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
      const box=e=>{const s=getComputedStyle(e);return {rect:rect(e),clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,overflowY:s.overflowY,gridRows:s.gridTemplateRows,alignContent:s.alignContent,alignItems:s.alignItems,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom};};
      const form=element.closest('form'),composer=form.parentElement,thread=composer.parentElement,ancestors=[];
      for(let e=element.parentElement;e;e=e.parentElement)ancestors.push({tag:e.tagName,...box(e)});
      return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,short:matchMedia('(max-height: 500px)').matches,singleRow:matchMedia('(min-width: 500px)').matches},shellHeader:box(document.querySelector('header')),footer:box(document.querySelector('nav[aria-label="Основные разделы"]')),hero:box(document.querySelector('[data-testid=thread-header]')),thread:box(thread),composer:box(composer),form:box(form),row:box(element.closest('label').parentElement),field:box(element.closest('label')),ancestors};
    });measurements.push(geometry);
    phase='textarea-width';assert.ok(geometry.editor.width>=140);phase='textarea-height';assert.ok(geometry.editor.height>=39);phase='textarea-fully-visible';assert.ok(geometry.editor.fullyVisible);phase='history-useful-height';assert.ok(geometry.historyUsableHeight>=48-1);phase='history-composer-nonoverlap';assert.ok(geometry.history.bottom<=geometry.composer.y+1);phase='history-independent-scroll';assert.ok(geometry.historyScrollHeight>geometry.historyClientHeight);phase='footer-exclusion';assert.ok(geometry.composer.bottom<=geometry.ancestors.footer.rect.y+1);
    const scroll=await page.getByTestId('history').evaluate(element=>{const previous=element.scrollTop;element.scrollTop=previous>1?0:element.scrollHeight;return {previous,after:element.scrollTop,documentY:scrollY,composerY:document.querySelector('[data-testid=composer]').getBoundingClientRect().y};});assert.notEqual(scroll.previous,scroll.after);assert.equal(scroll.documentY,geometry.documentY);assert.equal(scroll.composerY,geometry.composer.y);
    phase='composer-and-header-controls';for(const button of [...await page.getByTestId('composer').getByRole('button').all(),...await page.getByRole('button',{name:'Назад к списку',exact:true}).all(),...await page.getByRole('button',{name:'Управление звонком',exact:true}).all()]){if(!(await button.isEnabled()))continue;await tab(page,button);const b=await clipped(button);assert.ok(b.fullyVisible&&b.width>=32&&b.height>=32);}
    phase='combined-state-preserved';assert.equal(await page.getByRole('button',{name:'Отменить ответ',exact:true}).count(),1);assert.equal(await page.getByText('Файл готов к отправке.',{exact:true}).count(),1);assert.equal(await page.getByTestId('composer').getAttribute('data-send-attempts'),'1');assert.equal(await editor.inputValue(),draft);await editor.focus();await page.getByTestId('history').evaluate(element=>{element.scrollTop=element.scrollHeight;});
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
const junit=process.env.PINNED_LAYOUT_JUNIT;assert.ok(junit&&path.isAbsolute(junit)&&path.dirname(junit)===artifact);fs.writeFileSync(junit,`<?xml version="1.0"?><testsuite name="faithful-group-combined-composer" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${cases.map(row=>`<testcase classname="group-combined-composer" name="${row.name}">${row.status==='fail'?`<failure message="${row.errorKind}:${row.failedPhase}"/>`:''}</testcase>`).join('')}</testsuite>\n`,{mode:0o600,flag:'wx'});
const evidence={status:cases.length===1&&!failures&&!cleanupErrors.length&&listenerClosed&&ownedProcessesGone&&!pageErrors.length&&!interrupted?'pass':'fail',sourceRoot:web,source,browserExecutable:executable,artifact,profile,ownedPids,cases,pageErrors,cleanupErrors,listenerClosed,ownedProcessesGone,interrupted,scope:'One production GroupsCSS/SVG/LegacyShell combined reply+attachment+synthetic send-error trajectory, same320→568/focus/Tab; synthetic auth/RTC/attachment/upload/failure, no backend/nativezoom/device acceptance'};write('evidence.json',evidence);process.stdout.write(JSON.stringify(evidence)+'\n');if(evidence.status!=='pass')process.exitCode=1;
