import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {DesktopShell} from '../../src/shell/DesktopShell.tsx';
import '@fontsource/pt-sans/400.css';import '@fontsource/pt-sans/700.css';import '../../src/styles/reset.css';import '../../src/styles/tokens.css';import '../../src/styles/global.css';
createRoot(document.getElementById('root')).render(<BrowserRouter><DesktopShell onRequestRebootToBoot={()=>{}}/></BrowserRouter>);
