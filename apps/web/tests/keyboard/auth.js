const state={status:'authenticated',token:'owned-keyboard-fixture',profile:{id:'keyboard-user',login:'keyboard.fixture',nickname:'Keyboard Fixture'}};
export function useAuth(){return {state,logout:async()=>{}};}export function getAuthErrorMessage(_error,fallback){return fallback;}
