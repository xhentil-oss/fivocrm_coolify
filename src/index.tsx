import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './contexts/AuthContext';
import App from './App';
import './index.css';
import { initSentry } from './lib/sentry';
import { installNativeApiBase } from './lib/nativeApi';
import { installExternalLinkHandler } from './lib/native';

// On native, route relative /api/ calls to the deployed origin. Must run
// before any module fires a fetch.
installNativeApiBase();
// On native, open external links in the in-app browser instead of the WebView.
installExternalLinkHandler();

// Initialize error tracking
initSentry();

// Capacitor native plugin initialization
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Keyboard } from '@capacitor/keyboard';

if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Dark });
  StatusBar.setBackgroundColor({ color: '#09090B' });
  // setAccessoryBarVisible is iOS-only — it throws "not implemented" on Android.
  if (Capacitor.getPlatform() === 'ios') {
    Keyboard.setAccessoryBarVisible({ isVisible: true });
  }
  SplashScreen.hide();
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
