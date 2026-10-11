import {createInitialDirectCallAwarenessState} from '../../src/rtc/awareness';
const state=createInitialDirectCallAwarenessState();
export function useDirectCallAwareness(){return {state,refreshAllActiveDirectCalls:async()=>{},refreshDirectChatCall:async()=>{},dismissSurface(){},getEntry:()=>null};}
