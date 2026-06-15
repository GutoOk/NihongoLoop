import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ModalProvider } from './components/ModalProvider.tsx';

declare const __BUILD_VERSION__: string;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ModalProvider>
      <App />
    </ModalProvider>
  </StrictMode>,
);

// Register service worker for offline capability
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        registration.unregister().then(() => {
          console.log('Service Worker unregistered in development mode to prevent stale caching.');
        });
      }
    });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__BUILD_VERSION__)}`)
        .then((reg) => {
          console.log('Service Worker registered with scope:', reg.scope);
        })
        .catch((err) => {
          console.error('Service Worker registration failed:', err);
        });
    });
  }
}
