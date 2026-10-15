import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react-swc';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const here=fileURLToPath(new URL('.',import.meta.url)),web=fileURLToPath(new URL('../../',import.meta.url)),sourceRoot=process.env.ENTRY_SOURCE_ROOT??web;
const server=await createServer({configFile:false,root:here,plugins:[{name:'entry-fixture',enforce:'pre',resolveId(id,importer){
 if(importer?.endsWith('/harness.jsx')&&id.startsWith('../../src/'))return sourceRoot+'src/'+id.slice('../../src/'.length);
 if(importer?.endsWith('/AppRouter.tsx')&&['./AppShell','./app-routes','../shell/DesktopShell','../shell/MobileLauncherHome'].includes(id))return here+'post-auth.jsx';
}},react()],resolve:{alias:[{find:/^react$/,replacement:web+'node_modules/react/index.js'},{find:/^react-dom\/(.*)$/,replacement:web+'node_modules/react-dom/$1'}]},server:{host:'127.0.0.1',port:Number(process.env.ENTRY_FIXTURE_PORT??25174),strictPort:true,fs:{allow:[web,here,sourceRoot]}}});
await server.listen();const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});
try{
 const evidence=[];
 const baseline=process.env.ENTRY_EXPECT_BASELINE==='1';
 for(const width of [390,1280]){
  for(const mode of baseline?['login']:['login','register']){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
   await page.goto(server.resolvedUrls.local[0]+mode);await page.locator('[data-surface=chooser]').waitFor();
   if(baseline){
    assert.equal(await page.getByRole('button').count(),width>=1180?5:2);
    if(width>=1180){for(const name of ['OS2 Aero','OS3 Aero','Random'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),1);}
    assert.match(await page.locator('body').innerText(),/Use arrows/);
    evidence.push({width,scenario:'baseline-false-affordances',buttons:await page.getByRole('button').count()});await context.close();continue;
   }
   await page.getByRole('heading',{name:'XP Aero',exact:true}).waitFor();
   assert.equal(await page.getByRole('button').count(),1);assert.equal(await page.getByRole('button',{name:'Продолжить',exact:true}).count(),1);
   assert.doesNotMatch(await page.locator('body').innerText(),/OS2|OS3|Random|arrows|gateway|handoff|slice/);
   await page.keyboard.press('Tab');await page.keyboard.press('Enter');
   await page.getByRole('heading',{name:mode==='login'?'Войти в AeroChat':'Создать учётную запись',exact:true}).waitFor();
   if(mode==='login'){
    await page.getByRole('textbox',{name:'Логин',exact:true}).fill('fixture');await page.getByLabel('Пароль',{exact:true}).fill('synthetic-password');await page.getByRole('button',{name:'Войти',exact:true}).click();
    await page.getByText('Не удалось войти. Проверьте данные и повторите попытку.',{exact:true}).waitFor();
   }
   evidence.push({width,scenario:'first-'+mode,chooserButtons:1,authSurface:mode});await context.close();
  }
  if(baseline)continue;
  for(const reboot of [false,true]){
   const context=await browser.newContext({viewport:{width,height:900}});
   await context.addInitScript(value=>localStorage.setItem('aerochat.shell.runtime',JSON.stringify(value)),{chooserCompleted:true,rebootToBoot:reboot});
   const page=await context.newPage();await page.goto(server.resolvedUrls.local[0]+'app?auth=valid');
   const home=width>=1180?'Рабочий стол':'Мобильный экран';
   if(reboot){await page.getByRole('heading',{name:'XP Aero',exact:true}).waitFor();await page.getByRole('button',{name:'Продолжить',exact:true}).click();}
   await page.getByRole('heading',{name:home,exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'XP Aero',exact:true}).count(),0);
   if(width>=1180&&!reboot){await page.getByRole('button',{name:'Перезапустить AeroChat'}).click();await page.getByRole('heading',{name:'XP Aero',exact:true}).waitFor();await page.getByRole('button',{name:'Продолжить',exact:true}).click();await page.getByRole('heading',{name:home,exact:true}).waitFor();}
   evidence.push({width,scenario:reboot?'explicit-reboot':'daily-valid',home});await context.close();
  }
 }
 console.log(JSON.stringify({browser:await browser.version(),evidence,scope:'Actual AppRouter entry state, preferences, viewport, AuthPage, ShellEntrySurface; synthetic auth and post-auth shell substitutes. Backend login and full workspace unverified.'}));
}finally{await browser.close();await server.close();}
