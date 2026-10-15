import React from 'react';import {createRoot} from 'react-dom/client';
import {AppRouter} from '../../src/app/AppRouter.tsx';
import {writeShellBootPreferences} from '../../src/shell/preferences.ts';
import '@fontsource/pt-sans/400.css';import '@fontsource/pt-sans/700.css';import '../../src/styles/reset.css';import '../../src/styles/tokens.css';import '../../src/styles/global.css';
writeShellBootPreferences(localStorage,{chooserCompleted:true,rebootToBoot:false});
createRoot(document.getElementById('root')).render(<React.StrictMode><AppRouter/></React.StrictMode>);
