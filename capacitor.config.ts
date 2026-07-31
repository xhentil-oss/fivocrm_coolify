import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fivocrm.app',
  appName: 'FivoCRM',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  ios: {
    // Edge-to-edge: WKWebView must not add its own safe-area insets, otherwise
    // they stack on top of the env(safe-area-inset-*) padding the fixed top/bottom
    // bars already apply (see index.css / TopNavBar / MobileBottomNav).
    contentInset: 'never',
    // Matches the splash + app background so there is no white flash on launch
    // or when the WebView bounces past its content.
    backgroundColor: '#09090B',
  },
  plugins: {
    FirebaseAuthentication: {
      // We keep the Firebase JS SDK as the source of truth: the native plugin
      // only returns the Google credential, then we sign in via signInWithCredential.
      skipNativeAuth: true,
      providers: ['google.com'],
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#09090B',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#09090B',
      // Edge-to-edge: let the webview draw under the status bar. The fixed top/bottom
      // bars compensate with env(safe-area-inset-*) padding (see index.css / TopNavBar /
      // MobileBottomNav / PortalLayout) so nothing hides under the notch or gesture bar.
      overlaysWebView: true,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
