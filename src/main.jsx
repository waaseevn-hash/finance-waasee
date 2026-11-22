import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PrivacyProvider } from './context/PrivacyContext.jsx';
import { ConfirmProvider, ToastProvider } from './components/feedback.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PrivacyProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </PrivacyProvider>
  </StrictMode>,
);

// Cài như ứng dụng (Android, máy tính): đăng ký service worker ở bản chính thức
if ('serviceWorker' in navigator && import.meta.env?.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
