import '@fontsource-variable/outfit';
import './styles/tokens.css';
import './styles/base.css';
import './styles/board.css';
import './styles/visual.css';
import './styles/motion.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
