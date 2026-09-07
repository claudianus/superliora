import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './landing/landing.css';
import App from './landing/App';

const root = document.querySelector('#root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
