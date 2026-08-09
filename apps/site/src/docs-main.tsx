import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { DocsApp } from './docs/DocsApp';

const root = document.querySelector('#root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <DocsApp />
  </StrictMode>,
);
