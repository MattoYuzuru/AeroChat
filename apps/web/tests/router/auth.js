import {useSyncExternalStore} from 'react';
const storageKey='owned-router-fixture-auth',profile={id:'router-user',login:'router.fixture',nickname:'Router Fixture'};
const authenticated=()=>({status:'authenticated',token:'owned-router-fixture',profile,notice:null});
let state=localStorage.getItem(storageKey)==='1'?authenticated():{status:'anonymous',notice:null};const listeners=new Set();
const subscribe=callback=>{listeners.add(callback);return()=>listeners.delete(callback);},getState=()=>state;
const authenticate=async()=>{localStorage.setItem(storageKey,'1');state=authenticated();for(const callback of listeners)callback();};
export function useAuth(){return {state:useSyncExternalStore(subscribe,getState),login:authenticate,register:authenticate,clearNotice(){},expireSession(){},logout:async()=>{localStorage.removeItem(storageKey);state={status:'anonymous',notice:null};for(const callback of listeners)callback();}};}
export function getAuthErrorMessage(_error,fallback){return fallback;}
