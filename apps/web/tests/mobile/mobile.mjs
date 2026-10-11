import assert from 'node:assert/strict';import {mkdir} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {createServer} from 'vite';import react from '@vitejs/plugin-react-swc';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const here=fileURLToPath(new URL('.',import.meta.url)),web=fileURLToPath(new URL('../../',import.meta.url));
const sourceRoot=process.env.MOBILE_SOURCE_ROOT??web;
const server=await createServer({configFile:false,root:here,plugins:[{name:'mobile-fixture',enforce:'pre',resolveId(id,importer){
 if(importer?.endsWith('/AppShell.tsx')&&id==='../auth/useAuth')return here+'auth.js';
 if(importer?.endsWith('/AppShell.tsx')&&id==='../rtc/useDirectCallAwareness')return here+'rtc.js';
 if(importer?.endsWith('/harness.jsx')&&id.startsWith('../../src/'))return sourceRoot+'src/'+id.slice('../../src/'.length);
}},react()],resolve:{alias:[{find:/^react$/,replacement:web+'node_modules/react/index.js'},{find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'}]},server:{host:'127.0.0.1',port:Number(process.env.MOBILE_FIXTURE_PORT??25174),strictPort:true,fs:{allow:[here,web,sourceRoot,fileURLToPath(new URL("../../../../node_modules/",import.meta.url))]}}});
await server.listen();const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
try{
 const page=await browser.newPage();const evidence=[];
 const screenshotDir=process.env.MOBILE_SCREENSHOT_DIR;
 if(screenshotDir)await mkdir(screenshotDir,{recursive:true});
 for(const [width,height] of [[320,568],[390,844],[768,1024],[568,320],[844,390],[1024,768],[640,360]]){
  for(const lane of ['self','direct','group'])for(const count of [0,2,50])for(const state of count===50?['normal','reply','attachment','error','call']:['normal']){
   await page.setViewportSize({width,height});await page.goto(server.resolvedUrls.local[0]+`app/${lane==='self'?'self':lane==='group'?'groups':'chats'}?lane=${lane}&count=${count}&state=${state}`);
   const input=page.getByRole('textbox');await input.waitFor();await page.evaluate(()=>document.fonts.ready);
   for(let i=0;i<16;i++){if(await input.evaluate(e=>document.activeElement===e))break;await page.keyboard.press('Tab');}
   assert.equal(await input.evaluate(e=>document.activeElement===e),true,'keyboard reaches composer');
   await page.keyboard.type('Черновик сохраняется');
   const geometry=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    const history=document.querySelector('[data-testid=history]');const historyStyle=getComputedStyle(history);
    return {input:rect(document.querySelector('textarea')),composer:rect(document.querySelector('[data-testid=composer]')),header:rect(document.querySelector('[data-testid=thread-header]')),history:rect(history),overflow:document.documentElement.scrollWidth>innerWidth,documentHeight:document.documentElement.scrollHeight,historyScrollHeight:history.scrollHeight,historyClientHeight:history.clientHeight,historyUsableHeight:history.clientHeight-parseFloat(historyStyle.paddingTop)-parseFloat(historyStyle.paddingBottom)};
   });
   assert.equal(geometry.overflow,false,JSON.stringify({lane,count,width,height,geometry}));
   assert.ok(geometry.composer.bottom<=height+1,JSON.stringify({lane,count,width,height,geometry}));
   assert.ok(geometry.header.y>=0&&geometry.header.bottom<=geometry.composer.y,JSON.stringify({lane,count,state,width,height,geometry}));
   assert.ok(geometry.history.bottom<=geometry.composer.y+1,JSON.stringify({lane,count,state,width,height,geometry}));
   assert.ok(geometry.input.y>=geometry.composer.y&&geometry.input.bottom<=geometry.composer.bottom+1,JSON.stringify({lane,count,state,width,height,geometry}));
   assert.ok(geometry.input.width>=140,JSON.stringify({lane,count,width,height,geometry}));
   if(count===50){
    assert.ok(geometry.historyScrollHeight>geometry.historyClientHeight);assert.ok(geometry.historyUsableHeight>0,JSON.stringify({lane,count,state,width,height,geometry}));
    const scroll=await page.evaluate(()=>{const history=document.querySelector('[data-testid=history]');history.scrollTop=history.scrollHeight;return {top:history.scrollTop,composerBottom:document.querySelector('[data-testid=composer]').getBoundingClientRect().bottom,pageY:scrollY};});
    assert.ok(scroll.top>0);assert.equal(scroll.pageY,0);assert.equal(scroll.composerBottom,geometry.composer.bottom);
   }
   for(const control of await page.getByTestId('composer').getByRole('button').all()){
    await control.scrollIntoViewIfNeeded();const bounds=await control.boundingBox();
    assert.ok(bounds&&bounds.y>=geometry.composer.y-1&&bounds.y+bounds.height<=geometry.composer.bottom+1,JSON.stringify({lane,state,width,height,bounds,composer:geometry.composer}));
   }
   if(state==='call'){
    for(const label of ['Присоединиться','Скрыть']){const control=page.getByRole('button',{name:label,exact:true});await control.scrollIntoViewIfNeeded();const bounds=await control.boundingBox();assert.ok(bounds&&bounds.height>=31&&bounds.y>=0&&bounds.y+bounds.height<=height,JSON.stringify({lane,state,width,height,label,bounds}));}
   }
   const actions=[...(lane==='self'?[]:[lane==='group'?'Управление звонком':'Позвонить']),...(lane==='group'?[]:['Обновить thread']),'Назад к списку'];
   for(const action of actions){
    const control=page.getByRole('button',{name:action,exact:true});const bounds=await control.boundingBox();
    assert.equal(await control.isVisible(),true,action+' visible before rotation');
    assert.ok(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y>=0&&bounds.y+bounds.height<=height+1,JSON.stringify({lane,action,width,height,bounds}));
    let reached=false;for(let i=0;i<30;i++){if(await control.evaluate(element=>element===document.activeElement)){reached=true;break;}await page.keyboard.press('Tab');}
    assert.equal(reached,true,action+' keyboard reachable before rotation');
   }
   if(screenshotDir&&count===50&&['normal','error','call'].includes(state)&&[320,390,568].includes(width))await page.screenshot({path:`${screenshotDir}/${lane}-${width}x${height}${state==='normal'?'':'-'+state}.png`});
   await page.setViewportSize({width:height,height:width});assert.equal(await input.inputValue(),'Черновик сохраняется');
   if(state==='normal'&&count===50){
    await page.getByRole('button',{name:'Переписка',exact:false}).click();const information=page.getByTestId('information');await information.waitFor();
    assert.equal(await information.evaluate(e=>e.scrollHeight>e.clientHeight),true,'information scrolls');
    await page.getByRole('button',{name:'Назад к переписке',exact:true}).click();assert.equal(await input.inputValue(),'Черновик сохраняется');
   }
   for(const action of actions){
    const control=page.getByRole('button',{name:action,exact:true});assert.equal(await control.isVisible(),true,action+' visible');
    const bounds=await control.boundingBox();assert.ok(bounds&&bounds.y>=0&&bounds.y+bounds.height<=width+1,JSON.stringify({lane,action,width:height,height:width,bounds}));
    let reached=false;for(let i=0;i<30;i++){if(await control.evaluate(element=>element===document.activeElement)){reached=true;break;}await page.keyboard.press('Tab');}
    assert.equal(reached,true,action+' keyboard reachable');await page.keyboard.press('Enter');
    if(action==='Назад к списку'){await page.getByRole('button',{name:'Открыть переписку',exact:true}).click();assert.equal(await input.inputValue(),'Черновик сохраняется');}
    if(action==='Обновить thread')assert.equal(await page.locator('[data-fixture-refreshes]').getAttribute('data-fixture-refreshes'),'1');
    if(action==='Позвонить'||action==='Управление звонком')assert.equal(await page.locator('[data-fixture-calls]').getAttribute('data-fixture-calls'),'1');
   }
   evidence.push({lane,count,state,width,height,zoomModel:width===640&&height===360?'200% desktop layout equivalent: CSS viewport640x360 for1280x720; not native browser zoom':'100% CSS viewport',...geometry});
  }
 }
 console.log(JSON.stringify({browser:await browser.version(),cases:evidence.length,evidence,scope:'Production LegacyAppShell and conversation CSS with representative 0/2/50-message DOM; synthetic auth/RTC; actual iOS/Android OS keyboard and full chat pages unverified'}));
}finally{await browser.close();await server.close();}
