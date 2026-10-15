import React from 'react';
export function DesktopShell({onRequestRebootToBoot}){return <main><h1>Рабочий стол</h1><button onClick={onRequestRebootToBoot}>Перезапустить AeroChat</button></main>;}
export function MobileLauncherHome(){return <h1>Мобильный экран</h1>;}
export function LegacyAppShell({children}){return <main>{children}</main>;}
export const routeBackedShellApps=[{path:'/app/settings',appId:'settings',title:'Настройки',routePath:'/app/settings'}];
export function resolveShellRouteEntry(path){return path==='/app/settings'?{app:routeBackedShellApps[0],target:null}:null;}
export function renderShellAppContent(){return <h1>Настройки</h1>;}
