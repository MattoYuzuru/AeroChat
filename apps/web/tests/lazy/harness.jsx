import React from 'react';import {createRoot} from 'react-dom/client';
import {AppRouter} from '../../src/app/AppRouter.tsx';
import {RetryableLazyModule} from '../../src/app/lazy-module.tsx';
import {createLazyModule} from '../../src/app/lazy-module-loader.ts';
import ExplorerResource from 'virtual:aerochat-lazy-url/ExplorerPage';
import {writeShellBootPreferences} from '../../src/shell/preferences.ts';
import '@fontsource/pt-sans/400.css';import '@fontsource/pt-sans/700.css';import '../../src/styles/reset.css';import '../../src/styles/tokens.css';import '../../src/styles/global.css';
writeShellBootPreferences(localStorage,{chooserCompleted:true,rebootToBoot:false});
const pairModule=createLazyModule(()=>import('../../src/pages/ExplorerPage.tsx').then(({ExplorerPage})=>({default:ExplorerPage})),ExplorerResource,'ExplorerPage');
function Pair(){
 const [visible,setVisible]=React.useState(true);
 window.__lazyCanonical=pairModule.initialComponent;
 return <><label>Соседний черновик<input aria-label="Соседний черновик" defaultValue="Не потерять"/></label><button onClick={()=>setVisible(value=>!value)}>Переключить окна</button>{visible&&[0,1].map(id=><div key={id} data-pair={id}><RetryableLazyModule descriptor={pairModule} title={'Окно '+id} moduleProps={{}}/></div>)}</>;
}
globalThis.__lazyRootMounts=(globalThis.__lazyRootMounts??0)+1;
createRoot(document.getElementById('root')).render(location.pathname==='/retry-pair'?<Pair/>:<AppRouter/>);
