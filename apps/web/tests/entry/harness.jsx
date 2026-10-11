import React from 'react';
import {createRoot} from 'react-dom/client';
import {AppRouter} from '../../src/app/AppRouter.tsx';
import {AuthContext} from '../../src/auth/context.ts';
import '../../src/styles/reset.css';import '../../src/styles/tokens.css';import '../../src/styles/global.css';
const noop=()=>{};
const state=location.search.includes('auth=valid')?{status:'authenticated',token:'synthetic',notice:null,profile:{id:'fixture-user',login:'fixture',nickname:'Fixture'}}:{status:'anonymous',notice:null};
const auth={state,clearNotice:noop,discardSession:noop,retryBootstrap:noop,login:async()=>{throw {};},register:async()=>{throw {};}};
createRoot(document.getElementById('root')).render(<AuthContext value={auth}><AppRouter/></AuthContext>);
