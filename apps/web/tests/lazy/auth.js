import {useSyncExternalStore} from 'react';
let state={status:'anonymous',notice:null};const listeners=new Set();
const subscribe=callback=>{listeners.add(callback);return()=>listeners.delete(callback);};
const getState=()=>state;
const authenticate=async()=>{state={status:'authenticated',token:'owned-lazy-fixture',profile:{id:'lazy-user',login:'lazy.fixture',nickname:'Lazy Fixture'},notice:null};for(const callback of listeners)callback();};
export function useAuth(){return {state:useSyncExternalStore(subscribe,getState),login:authenticate,register:authenticate,clearNotice(){},expireSession(){},logout:async()=>{}};}
export function getAuthErrorMessage(_error,fallback){return fallback;}
