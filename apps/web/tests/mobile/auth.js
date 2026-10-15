const noop=()=>{};
export function useAuth(){return {state:{status:'authenticated',profile:{id:'self',login:'layout.fixture',nickname:'Layout fixture'}},logout:async()=>{},clearNotice:noop};}
export function getAuthErrorMessage(){return 'Synthetic error';}
