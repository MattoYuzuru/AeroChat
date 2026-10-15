import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
process.umask(0o077);
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=fileURLToPath(new URL('.',import.meta.url));
const web=path.resolve(process.env.GROUP_SENDER_PROJECTION_SOURCE_ROOT??fileURLToPath(new URL('../../',import.meta.url)))+'/';
const repoRoot=fs.realpathSync(path.resolve(web,'../..'));
const artifact=process.env.GROUP_SENDER_PROJECTION_ARTIFACT_DIR;assert.ok(artifact&&path.isAbsolute(artifact)&&fs.realpathSync(artifact)===path.resolve(artifact)&&fs.statSync(artifact).isDirectory()&&(fs.statSync(artifact).mode&0o077)===0);
const profile=path.join(artifact,'cft-profile');fs.mkdirSync(profile,{mode:0o700});
const executable=fs.realpathSync(process.env.CHROMIUM_EXECUTABLE);
const {createServer}=await import(pathToFileURL(web+'node_modules/vite/dist/node/index.js').href);
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const port=Number(process.env.GROUP_SENDER_PROJECTION_FIXTURE_PORT??25174);assert.ok(Number.isInteger(port)&&port>1024&&port<65536);
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files=['groups/useEncryptedGroupLane.ts','groups/encrypted-group-local-outbound.ts','groups/encrypted-group-projection.ts','groups/encrypted-group-realtime.ts','crypto/runtime-context.ts'];
const source=Object.fromEntries(files.map(file=>[file,sha(web+'src/'+file)]));
const imports=`export {useEncryptedGroupLane} from '${web}src/groups/useEncryptedGroupLane.ts';export {CryptoRuntimeContext} from '${web}src/crypto/runtime-context.ts';export {gatewayClient} from '${web}src/gateway/runtime.ts';export {publishEncryptedGroupRealtimeEvent,clearBufferedEncryptedGroupRealtimeEvents} from '${web}src/groups/encrypted-group-realtime.ts';export {publishLocalEncryptedGroupProjection,clearBufferedLocalEncryptedGroupProjection,listBufferedLocalEncryptedGroupProjection} from '${web}src/groups/encrypted-group-local-outbound.ts';`;
const server=await createServer({configFile:false,root:here,resolve:{alias:[{find:/^react$/,replacement:web+'node_modules/react/index.js'},{find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'}]},plugins:[{name:'group-sender-projection-fixture',resolveId(id){if(id==='virtual:group-sender-projection')return '\0group-sender-projection';},load(id){if(id==='\0group-sender-projection')return imports;}}],server:{host:'127.0.0.1',port,strictPort:true,fs:{allow:[repoRoot,web,here]}}});
let context,ownedPids=[],interrupted=false;const cases=[],pageErrors=[];const cleanupErrors=[];
const write=(name,value)=>{const fd=fs.openSync(path.join(artifact,name),'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
const bounded=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Owned cleanup bound')),1500))]);
const processRows=()=>execFileSync('ps',['-ww','-axo','pid=,pgid=,command='],{encoding:'utf8',timeout:500}).split('\n').map(row=>row.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)).filter(Boolean).map(row=>({pid:Number(row[1]),pgid:Number(row[2]),command:row[3]}));
const freshOwned=()=>processRows().filter(row=>row.command.startsWith(executable+' ')&&(row.command+' ').includes('--user-data-dir='+profile+' '));
const killOwned=()=>{for(const row of freshOwned()){assert.equal(row.pid,row.pgid);assert.notEqual(row.pgid,process.pid);try{process.kill(-row.pgid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}}};
const onSignal=()=>{interrupted=true;process.exitCode=1;try{killOwned();}catch{cleanupErrors.push('owned-signal-cleanup');}server.httpServer?.close();};
process.on('SIGTERM',onSignal);process.on('SIGINT',onSignal);
const ownership={owned:true,nodePid:process.pid,profile,executable,executableSha256:sha(executable),port,source,phase:'prelaunch'};write('ownership.json',ownership);

try{
 await server.listen();assert.equal(sha(executable),ownership.executableSha256);context=await chromium.launchPersistentContext(profile,{headless:true,executablePath:executable,handleSIGTERM:false,handleSIGINT:false});
 ownedPids=freshOwned().map(row=>{assert.equal(row.pid,row.pgid);return {pid:row.pid,pgid:row.pgid,startTime:execFileSync('ps',['-p',String(row.pid),'-o','lstart='],{encoding:'utf8',timeout:500}).trim(),commandSha256:crypto.createHash('sha256').update(row.command).digest('hex')};});assert.equal(ownedPids.length,1);
 write('browser-pids.json',{owned:true,profile,executable,processes:ownedPids,browser:context.browser().version()});
 const page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',error=>pageErrors.push(error.name));
 const origin=server.resolvedUrls.local[0];
 await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(origin).origin?route.continue():route.abort());
 for(const kind of ['ready','failure','group-change','token-change','device-change','retired-device','disabled']){
  let phase='goto';
  try{
   await page.goto(origin);phase='fixture-bootstrap';await page.waitForFunction(()=>window.fixture);phase='mount';await page.evaluate(()=>window.fixture.mount());
   phase='initial-lane-ready';await page.waitForFunction(()=>window.fixture.report()?.status==='ready');
   let report=await page.evaluate(()=>window.fixture.report());assert.equal(report.ready.length,0);assert.equal(report.failures.length,0);assert.equal(report.listCalls,1);assert.equal(report.bootstrapCalls,1);assert.equal(report.bootstrapGroupId,'group-1');
   phase='server-copy-observed';await page.evaluate(()=>window.fixture.startServerCopy());await page.waitForFunction(()=>window.fixture.report().decryptCalls===1);
   const renders=report.providerRenders;phase='pending-identity-flip';await page.evaluate(()=>window.fixture.finishSendState());
   report=await page.evaluate(()=>window.fixture.report());assert.ok(report.providerRenders>=renders+2);assert.equal(report.pending,false);assert.equal(report.decryptCalls,1);assert.equal(report.bootstrapCalls,1);assert.equal(report.listCalls,1);
   phase='late-local-publish-suppressed';await page.evaluate(()=>window.fixture.publishStoredSendResult());report=await page.evaluate(()=>window.fixture.report());
   assert.equal(report.buffered,0,'Authoritative copy suppresses late optimistic buffer');assert.equal(report.ready.length,0,'No optimistic fallback before authoritative decrypt');
   const scoped=!['ready','failure'].includes(kind),expectedStatus=kind==='disabled'?'idle':kind==='retired-device'?'unavailable':'ready';
   if(scoped){phase='scope-change';await page.evaluate(kind=>window.fixture.changeScope(kind),kind);await page.waitForFunction(({kind,status})=>window.fixture.report().scope===kind&&window.fixture.report().status===status,{kind,status:expectedStatus});}
   phase='authoritative-decrypt-release';await page.evaluate(kind=>window.fixture.resolveServerCopy(kind),kind);
   phase='authoritative-visible';if(kind==='ready')await page.waitForFunction(()=>window.fixture.report().ready.length===1,null,{timeout:2000});
   else if(kind==='failure')await page.waitForFunction(()=>window.fixture.report().failures.length===1,null,{timeout:2000});
   else await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   phase='final-lane-assertions';report=await page.evaluate(()=>window.fixture.report());assert.equal(report.status,expectedStatus);assert.equal(report.buffered,0);assert.equal(report.decryptCalls,1);
   if(kind==='ready'){assert.deepEqual(report.ready,[{messageId:'message-1',text:'synthetic group sender body',revision:1,serverSequence:'1'}]);assert.deepEqual(report.failures,[]);}
   else if(kind==='failure'){assert.deepEqual(report.ready,[]);assert.deepEqual(report.failures,[{messageId:'message-1',failureKind:'aad_mismatch'}]);}
   else {assert.equal(report.scope,kind);assert.equal(report.groupId,kind==='group-change'?'group-2':'group-1');assert.deepEqual(report.ready,[]);assert.deepEqual(report.failures,[]);}
   assert.deepEqual(pageErrors,[]);phase='unmount';await page.evaluate(()=>window.fixture.unmount());cases.push({name:kind,status:'pass',ready:report.ready.length,failures:report.failures.length,buffered:report.buffered,providerRenders:report.providerRenders,bootstrapCalls:report.bootstrapCalls,listCalls:report.listCalls,decryptCalls:report.decryptCalls});
  }catch(error){const counters=await page.evaluate(()=>{const r=window.fixture?.report();return r?{status:r.status,ready:r.ready.length,failures:r.failures.length,buffered:r.buffered,providerRenders:r.providerRenders,bootstrapCalls:r.bootstrapCalls,listCalls:r.listCalls,decryptCalls:r.decryptCalls}:null;}).catch(()=>null);cases.push({name:kind,status:'fail',errorKind:error.name,failedPhase:phase,counters});}
 }
}finally{
 if(context)try{await bounded(context.close());}catch{cleanupErrors.push('owned-browser-close');}
 try{killOwned();}catch{cleanupErrors.push('owned-force-close');}
 try{await bounded(server.close());}catch{cleanupErrors.push('owned-vite-close');}
 process.off('SIGTERM',onSignal);process.off('SIGINT',onSignal);
}
assert.equal(sha(executable),ownership.executableSha256,'Owned executable unchanged');
assert.deepEqual(Object.fromEntries(files.map(file=>[file,sha(web+'src/'+file)])),source,'Production source unchanged during fixture');
const listenerClosed=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port});socket.setTimeout(1000);socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',()=>{socket.destroy();resolve(true);});socket.once('timeout',()=>{socket.destroy();resolve(false);});});
const ownedProcessesGone=processRows().every(row=>!(row.command+' ').includes('--user-data-dir='+profile+' ')&&!ownedPids.some(saved=>saved.pgid===row.pgid));
const failures=cases.filter(row=>row.status==='fail').length;
if(process.env.GROUP_SENDER_PROJECTION_JUNIT){const target=process.env.GROUP_SENDER_PROJECTION_JUNIT;assert.ok(path.isAbsolute(target));fs.writeFileSync(target,`<?xml version="1.0"?><testsuite name="actual-production-group-hook-context-race" tests="${cases.length}" failures="${failures}" errors="0" skipped="0">${cases.map(row=>`<testcase classname="group-sender-projection" name="${row.name}">${row.status==='fail'?`<failure message="${row.errorKind}:${row.failedPhase}"/>`:''}</testcase>`).join('')}</testsuite>\n`,{mode:0o600,flag:'wx'});}
const evidence={status:cases.length===7&&failures===0&&cleanupErrors.length===0&&listenerClosed&&ownedProcessesGone&&pageErrors.length===0&&!interrupted?'pass':'fail',sourceRoot:web,source,browserExecutable:executable,artifact,profile,ownedPids,cases,pageErrors,cleanupErrors,listenerClosed,ownedProcessesGone,interrupted,scope:'Actual production group React hook, outbound buffer and projection merge; synthetic gateway/deferred crypto; no native backend/WebCrypto/browser core acceptance'};write('evidence.json',evidence);process.stdout.write(JSON.stringify(evidence)+'\n');
if(cases.length!==7||failures||cleanupErrors.length||!listenerClosed||pageErrors.length||!ownedProcessesGone||interrupted)process.exitCode=1;
