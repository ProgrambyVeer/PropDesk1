import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import { AuthProvider } from './lib/auth';
import './index.css';
import { initTheme } from './lib/theme';

initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster position="top-center" closeButton className="estate-toaster" />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
