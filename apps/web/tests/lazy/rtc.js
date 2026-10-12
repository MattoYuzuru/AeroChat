import {createInitialDirectCallAwarenessState} from '../../src/rtc/awareness';
import {createDirectCallJoinCoordinator} from '../../src/rtc/join-coordinator';
import {createLocalCallCaptureOwner} from '../../src/rtc/local-call-capture-owner';
const state=createInitialDirectCallAwarenessState();
const joinCoordinator=createDirectCallJoinCoordinator(),localCaptureOwner=createLocalCallCaptureOwner(),captureAuthEpoch=Symbol();
export function useDirectCallAwareness(){return {state,joinCoordinator,localCaptureOwner,captureAuthEpoch,refreshAllActiveDirectCalls:async()=>{},refreshDirectChatCall:async()=>{},dismissSurface(){},getEntry:()=>null};}
