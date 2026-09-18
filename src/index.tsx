import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './contexts/AuthContext';
import App from './App';
import './index.css';
import { initSentry } from './lib/sentry';
import { installNativeApiBase } from './lib/nativeApi';
import { installExternalLinkHandler, applyAndroidSafeAreaFallback } from './lib/native';

// On native, route relative /api/ calls to the deployed origin. Must run
// before any module fires a fetch.
installNativeApiBase();
// On native, open external links in the in-app browser instead of the WebView.
installExternalLinkHandler();

// iOS (native WKWebView AND mobile Safari) zooms in whenever a focused field
// renders below 16px and never zooms back out. index.css raises the font size
// behind this flag only — Android/desktop keep their dense sizing. Set before
// render so the first paint is already correct.
if (
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
) {
  document.documentElement.classList.add('plt-ios');
}

// Initialize error tracking
initSentry();

// Capacitor native plugin initialization
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Keyboard } from '@capacitor/keyboard';

if (Capacitor.isNativePlatform()) {
  const platform = Capacitor.getPlatform();
  // Activates the native-only CSS in index.css (horizontal safe-area padding on
  // <body>, no overscroll bounce) — nothing else adds this class.
  document.documentElement.classList.add('plt-capacitor');
  // Each of these rejects on the platform that doesn't implement it, which would
  // surface as an unhandled promise rejection at startup — so guard and swallow.
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  if (platform === 'android') {
    // setBackgroundColor is Android-only; on iOS the status bar is transparent and
    // the WebView's own background shows through.
    void StatusBar.setBackgroundColor({ color: '#09090B' }).catch(() => {});
    // Android ≤14: stamp --safe-area-inset-top when neither Capacitor's
    // SystemBars injection (API 35+) nor env() provides it.
    void applyAndroidSafeAreaFallback();
  }
  if (platform === 'ios') {
    // setAccessoryBarVisible is iOS-only — it throws "not implemented" on Android.
    void Keyboard.setAccessoryBarVisible({ isVisible: true }).catch(() => {});
  }
  void SplashScreen.hide().catch(() => {});
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
