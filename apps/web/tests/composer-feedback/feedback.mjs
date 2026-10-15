import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react-swc';
import ts from 'typescript';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE);
const here = fileURLToPath(new URL('.', import.meta.url));
const web = fileURLToPath(new URL('../../', import.meta.url));
const source = await readFile(web + 'src/pages/ChatsPage.tsx', 'utf8');
function slice(startText, endText) {
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert.ok(start > 0 && end > start, startText + ' source contract');
  return source.slice(start, end);
}
const send = slice('  async function handleEncryptedDirectMessageV2Send()', '  async function handleDeleteEncryptedDirectMessageV2(');
const submit = slice('  async function handleComposerSubmit(', '  function handleBackToChatsList()');
const sendingState = slice('  const [isComposerSending', '  const [composerError');
const completion = slice('  const composerCompletionRef = useRef(', '  const activeReadStatusLabel');
const textarea = source.indexOf('<textarea', source.indexOf('<DirectComposerFeedback'));
const changeStart = source.indexOf('                          onChange={(event) => {', textarea);
const changeEnd = source.indexOf('                          }}', changeStart);
assert.ok(textarea > 0 && changeStart > textarea && changeEnd > changeStart);
const change = source.slice(changeStart, changeEnd);
const changeBody = change.slice(change.indexOf('=> {') + 4);
const site = slice('                    <DirectComposerFeedback', '                    {selectedEncryptedReplyEntry');
assert.match(source, /<section className=\{styles.composerCard\} ref=\{composerViewportRef\}>\s*<form[^>]+>\s*<DirectComposerFeedback/);
assert.match(source, /aria-describedby=\{composerFeedbackMessage \? composerFeedbackId : undefined\}/);
assert.equal((source.match(/!hasActiveComposer && composerFeedbackMessage/g) ?? []).length, 2, 'old copies suppressed while composer is present');
assert.match(source, /const hasActiveComposer =\s*selectedThread !== null &&\s*chats.state.threadStatus === "ready" &&\s*directWindowContentMode === "thread";/);

const virtual = ts.transpileModule(`
import {useId,useLayoutEffect,useRef,useState} from 'react';
import {DirectComposerFeedback} from '${web}src/chats/DirectComposerFeedback.tsx';
import {normalizeComposerMessageText} from '${web}src/attachments/message-content.ts';
export function useProductionComposer({chats,cryptoRuntime,encryptedMediaAttachmentDraft}) {
 const [composerText,setComposerText]=useState('');
 ${sendingState}
 const [composerError,setComposerError]=useState(null);
 const composerFeedbackId=useId(),composerViewportRef=useRef(null);
 const selectedThread={chat:{id:'fixture-chat'}}, uploadedEncryptedAttachmentDraft=null;
 const editingEncryptedEntry=null,selectedEncryptedReplyEntry=null;
 const selectedEncryptedReplyMessageId=null,editingEncryptedMessageId=null;
 const setSelectedEncryptedReplyMessageId=()=>{},setEditingEncryptedMessageId=()=>{};
 const publishLocalEncryptedDirectMessageV2Projection=()=>{};
 ${completion}
 ${send}\n${submit}
 const composerFeedbackMessage=composerError ?? chats.state.actionErrorMessage;
 return {composerText,composerError,composerFeedbackMessage,composerFeedbackId,composerViewportRef,isPageVisible:true,pending:isComposerSending,
   handleComposerSubmit,handleComposerKeyDown,onChange:event=>{${changeBody}}};
}
export function FeedbackSite({composerFeedbackId,composerFeedbackMessage,composerViewportRef,isPageVisible,styles}) {
 return (${site});
}`, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX}}).outputText;

const shortError = 'Не удалось отправить сообщение: owned fixture HTTP 503.';
const longError = shortError + ' Подробная ошибка временной недоступности gateway. Повторите отправку позже.'.repeat(30);
const server = await createServer({configFile: false, root: here, plugins: [{
  name: 'feedback-fixture', enforce: 'pre',
  resolveId(id, importer) {
    if (id === 'virtual:composer-feedback') return '\0composer-feedback';
    if (importer?.endsWith('/AppShell.tsx') && id === '../auth/useAuth') return here + 'auth.js';
    if (importer?.endsWith('/AppShell.tsx') && id === '../rtc/useDirectCallAwareness') return here + 'rtc.js';
  },
  load(id) {if (id === '\0composer-feedback') return virtual;},
  configureServer(vite) {
    vite.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith('/__send?') || request.method !== 'POST') return next();
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({message: request.url.includes('mode=long') ? longError : shortError}));
    });
  },
}, react()], resolve: {alias: [
  {find: /^react$/, replacement: web + 'node_modules/react/index.js'},
  {find: /^react-dom\/(.*)$/, replacement: web + 'node_modules/react-dom/$1'},
]}, server: {host: '127.0.0.1', port: Number(process.env.FEEDBACK_FIXTURE_PORT ?? 25174), strictPort: true,
  fs: {allow: [here, web, fileURLToPath(new URL('../../../../node_modules/', import.meta.url))]}}});

await server.listen();
let browser, page;
const evidence = [], errors = [], directory = process.env.FEEDBACK_ARTIFACT_DIR;
if (directory) await mkdir(directory, {recursive: true});
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE});
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const draft = 'Synthetic unsent draft';
  for (const [width, height] of [[320,568],[390,844],[768,1024],[568,320],[844,390],[1024,768]]) {
    for (const lane of ['direct', 'self']) for (const mode of ['short', 'long']) {
      await page.setViewportSize({width, height});
      await page.goto(server.resolvedUrls.local[0] + `app/${lane === 'self' ? 'self' : 'chats'}?mode=${mode}`);
      const input = page.getByRole('textbox', {name: 'Сообщение', exact: true});
      await input.waitFor();
      await page.evaluate(() => document.fonts.ready);
      await input.fill(draft);
      const before = await page.evaluate(() => {
        const history = document.querySelector('[data-testid=history]');
        history.scrollTop = 100;
        const composer = document.querySelector('[data-testid=composer]');
        composer.scrollTop = composer.scrollHeight;
        return {history: history.scrollTop, page: scrollY};
      });
      const response = page.waitForResponse(r => r.url().includes('/__send?') && r.request().method() === 'POST');
      await input.press('Enter');
      assert.equal((await response).status(), 503, 'actual owned fixture refusal');
      const alert = page.getByRole('alert');
      await alert.waitFor({state: 'visible'});
      assert.equal(await alert.count(), 1, 'exactly one visible feedback');
      assert.equal(await input.inputValue(), draft, 'failed send retains draft');
      assert.equal(await input.evaluate(e => document.activeElement === e), true, 'feedback does not steal focus');
      assert.equal(await input.getAttribute('aria-describedby'), await alert.getAttribute('id'));
      const shown = await page.evaluate(() => {
        const composer = document.querySelector('[data-testid=composer]'), alert = document.querySelector('[role=alert]');
        const history = document.querySelector('[data-testid=history]'), h = getComputedStyle(history);
        const c = composer.getBoundingClientRect(), a = alert.getBoundingClientRect();
        return {composerTop: c.top, composerBottom: c.bottom, alertTop: a.top, alertBottom: a.bottom,
          composerScroll: composer.scrollTop, historyScroll: history.scrollTop, page: scrollY,
          historyUseful: history.clientHeight - parseFloat(h.paddingTop) - parseFloat(h.paddingBottom),
          longScrollable: alert.scrollHeight > alert.clientHeight, overflow: document.documentElement.scrollWidth > innerWidth};
      });
      assert.equal(shown.overflow, false);
      assert.equal(shown.composerScroll, 0, 'only composer reveals first feedback row');
      assert.equal(shown.historyScroll, before.history);
      assert.equal(shown.page, before.page);
      assert.ok(shown.alertTop >= shown.composerTop && shown.alertBottom <= shown.composerBottom + 1, JSON.stringify({width,height,mode,shown}));
      assert.ok(shown.composerBottom <= height + 1 && shown.historyUseful >= 48, JSON.stringify({width,height,mode,shown}));
      if (mode === 'long') assert.equal(shown.longScrollable, true, 'long feedback has own bounded scroll');
      if (directory && lane === 'direct' && [320,568,768].includes(width)) {
        await page.screenshot({path: `${directory}/${width}x${height}-${mode}.png`});
      }
      // Обычный Shift+Tab раскрывает alert; затем Tab возвращает textarea/actions.
      for (let i = 0; i < 3 && !await alert.evaluate(e => document.activeElement === e); i++) await page.keyboard.press('Shift+Tab');
      assert.equal(await alert.evaluate(e => document.activeElement === e), true, 'alert keyboard reachable');
      if (mode === 'long') {
        await page.keyboard.press('End');
        await page.waitForFunction(() => document.querySelector('[role=alert]').scrollTop > 0);
      }
      for (const label of ['Прикрепить файл', 'Сообщение', 'Записать голосовое сообщение', 'Записать видео сообщение', 'Отправить сообщение']) {
        const control = label === 'Сообщение' ? input : page.getByRole('button', {name: label, exact: true});
        let reached = false;
        for (let i = 0; i < 8; i++) {
          if (await control.evaluate(e => document.activeElement === e)) {reached = true; break;}
          await page.keyboard.press('Tab');
        }
        assert.equal(reached, true, label + ' reached by natural Tab');
        const box = await control.boundingBox(), composer = await page.getByTestId('composer').boundingBox();
        assert.ok(box && composer && box.y >= composer.y - 1 && box.y + box.height <= composer.y + composer.height + 1, JSON.stringify({label,width,height,box,composer}));
        if (label === 'Сообщение') assert.ok(box.width >= 140, 'textarea useful width');
        else assert.ok(box.height >= 32, label + ' action target');
      }
      const postFocus = await page.evaluate(() => ({history: document.querySelector('[data-testid=history]').scrollTop, page: scrollY}));
      assert.deepEqual(postFocus, before, 'natural Tab leaves history/page scroll unchanged');
      assert.equal(await input.inputValue(), draft);
      await input.focus();
      await input.press('End');
      await input.press('!');
      await page.waitForFunction(() => window.feedback.report().error === null);
      assert.equal(await alert.count(), 0, 'production onChange clears error');
      assert.equal(await input.getAttribute('aria-describedby'), null);
      assert.equal(await input.inputValue(), draft + '!');
      assert.equal((await page.evaluate(() => window.feedback.report())).calls, 1);
      assert.equal((await page.evaluate(() => window.feedback.report())).failures, 1);
      assert.equal((await page.evaluate(() => window.feedback.report())).pending, false, 'versioned send lock released after refusal');
      assert.deepEqual(errors, [], 'no actual browser errors');
      evidence.push({width,height,lane,mode,status:503,shown,naturalTab:true,draftRetained:true,errorCleared:true});
    }
  }
  const result = {browser: await browser.version(), sourceSHA256: createHash('sha256').update(source).digest('hex'), cases: evidence.length, pageErrors: errors, evidence,
    scope: 'Actual production feedback component/site and exact send/submit/Enter/change handlers, React, LegacyAppShell and Chats CSS. Representative 50-row direct/self DOM, synthetic auth/RTC and HTTP503 crypto-action adapter. Actual backend/accounts/physical keyboard/touch/native zoom not proved.'};
  if (directory) await writeFile(directory + '/evidence.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (directory && page) {
    await page.screenshot({path: directory + '/failure.png'});
    await writeFile(directory + '/failure.json', JSON.stringify({message: error.message, url: page.url(), errors,
      measurement: await page.evaluate(() => [...document.querySelectorAll('[role=alert],textarea,[data-testid=composer],[data-testid=history]')].map(e => {
        const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,role:e.getAttribute('role'),rect:{x:r.x,y:r.y,width:r.width,height:r.height},clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom,overflow:s.overflowY};
      }))}, null, 2));
  }
  throw error;
} finally {
  try {if (browser) await browser.close();} finally {await server.close();}
}
