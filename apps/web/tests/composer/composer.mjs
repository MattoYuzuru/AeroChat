import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import ts from 'typescript';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const here=fileURLToPath(new URL('.',import.meta.url)),web=fileURLToPath(new URL('../../',import.meta.url));
const source=await readFile((process.env.COMPOSER_SOURCE_ROOT??web)+'src/pages/ChatsPage.tsx','utf8');
const sendStart=source.indexOf('  async function handleEncryptedDirectMessageV2Send()');
const sendEnd=source.indexOf('  async function handleDeleteEncryptedDirectMessageV2(',sendStart);
const keyStart=source.indexOf('  function handleComposerKeyDown('),keyEnd=source.indexOf('  function handleBackToChatsList()',keyStart);
const completeStart=source.indexOf('  const completeSentComposer = useEffectEvent(');
const completeEnd=source.indexOf('  const activeReadStatusLabel',completeStart);
assert.ok(sendStart>0&&sendEnd>sendStart&&keyStart>0);
const complete=completeStart<0?'':source.slice(completeStart,completeEnd);
const stateStart=source.indexOf('  const [isComposerSending'),stateEnd=source.indexOf('  const [composerError',stateStart);
const state=stateStart<0?'const isComposerSending=false;':source.slice(stateStart,stateEnd);
const textareaStart=source.indexOf('                          onChange={(event) => {',source.indexOf('<textarea'));
const onChangeEnd=source.indexOf('                          }}',textareaStart);
const onChange=source.slice(source.indexOf('=> {',textareaStart)+4,onChangeEnd);
const virtual=ts.transpileModule(`import {useEffectEvent,useRef,useState} from 'react';export function useComposer(opts){
 const {selectedThread,uploadedEncryptedAttachmentDraft,editingEncryptedEntry,selectedEncryptedReplyEntry,selectedEncryptedReplyMessageId,editingEncryptedMessageId,setSelectedEncryptedReplyMessageId,setEditingEncryptedMessageId,chats,normalizeComposerMessageText,cryptoRuntime,encryptedMediaAttachmentDraft,publishLocalEncryptedDirectMessageV2Projection}=opts;
 const [composerText,setComposerText]=useState('');const [composerError,setComposerError]=useState(null);
 ${state}\n${complete}\n${source.slice(sendStart,sendEnd)}\n${source.slice(keyStart,keyEnd)}
 return {text:composerText,error:composerError,pending:isComposerSending,send:handleEncryptedDirectMessageV2Send,onKeyDown:handleComposerKeyDown,onChange:event=>{${onChange}}};
}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const server=await createServer({configFile:false,root:here,resolve:{alias:[{find:/^react$/,replacement:web+'node_modules/react/index.js'},{find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'}]},plugins:[{name:'composer-fixture',resolveId(id){if(id==='virtual:composer')return '\0composer';},load(id){if(id==='\0composer')return virtual;}}],server:{host:'127.0.0.1',port:Number(process.env.COMPOSER_FIXTURE_PORT??25174),strictPort:true,fs:{allow:[web,here]}}});
await server.listen();const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
try{
 const page=await browser.newPage();const evidence=[];
 for(const scenario of ['typing','reentrant','failure','scope','reply','unchanged','cancel']){
  await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.fixture);await page.evaluate(()=>window.fixture.mount());
  await page.getByRole('textbox').fill('first message');
  if(scenario==='reentrant')await page.evaluate(()=>window.fixture.twice());else await page.getByRole('textbox').press('Enter');
  await page.waitForFunction(()=>window.fixture.report().calls.length>=1);
  assert.equal((await page.evaluate(()=>window.fixture.report())).calls[0].text,'first message');
  if(scenario==='typing'){await page.getByRole('textbox').fill('new unsent draft');await page.getByRole('textbox').press('Enter');}
  if(scenario==='scope'){await page.evaluate(()=>window.fixture.switchThread());await page.getByRole('textbox').fill('other thread draft');}
  if(scenario==='reply')await page.evaluate(()=>window.fixture.changeReply());
  if(scenario==='failure')await page.evaluate(()=>window.fixture.fail());else if(scenario==='cancel')await page.evaluate(()=>window.fixture.cancel());else await page.evaluate(()=>window.fixture.succeed());
  await page.waitForTimeout(30);const report=await page.evaluate(()=>window.fixture.report());
  assert.equal(report.calls.length,1,scenario+' exactly one mutation');assert.equal(report.pending,false,scenario+' lock released');
  if(scenario==='typing')assert.equal(report.text,'new unsent draft');
  if(scenario==='scope'){assert.equal(report.text,'other thread draft');assert.equal(report.clears,0);}
  if(scenario==='failure'){assert.equal(report.text,'first message');assert.equal(report.clears,0);assert.equal(report.failed,1);assert.equal(report.reply,'reply-1');assert.equal(report.error,'synthetic failure');}
  if(scenario==='reply'){assert.equal(report.text,'first message');assert.equal(report.reply,'reply-2');}
  if(scenario==='unchanged'){assert.equal(report.text,'');assert.equal(report.clears,1);assert.equal(report.reply,null);}
  if(scenario==='cancel'){assert.equal(report.text,'first message');assert.equal(report.clears,0);}
  if(scenario==='failure'){
   await page.getByRole('button').click();await page.waitForFunction(()=>window.fixture.report().calls.length===2);
   await page.evaluate(()=>window.fixture.succeed());await page.waitForFunction(()=>window.fixture.report().text==='');
  }
  evidence.push({scenario,...report});await page.evaluate(()=>window.fixture.unmount());
 }
 console.log(JSON.stringify({browser:await browser.version(),evidence,scope:'Actual React composer state, completion event, exact production send/Enter/change handlers; synthetic delayed crypto action, no ciphertext/network claim'}));
}finally{await browser.close();await server.close();}
