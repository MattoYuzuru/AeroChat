const state={syncStatus:'ready',errorMessage:null,chatsById:{},activeCallsByChatId:{},dismissedCallIdsByChatId:{}};
export function useDirectCallAwareness(){return {state,dismissSurface(){}};}
