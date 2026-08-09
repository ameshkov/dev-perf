/**
 * Entry point of the dev-perf viewer web app: mounts the root
 * component and loads the global stylesheets. No business logic.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/index.js';
import './styles/base.css';
import './styles/layout.css';
import './styles/hero.css';
import './styles/upload.css';
import './styles/dashboard.css';
import './styles/user.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('the #root element is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
