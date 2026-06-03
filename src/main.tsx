import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global error handling to prevent non-critical or transient/network failures from surfacing as crashes
window.addEventListener('error', (event) => {
  console.warn('Recoverable global error captured:', event.message || event.error);
  event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
  console.warn('Recoverable unhandled promise rejection captured:', event.reason);
  event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
