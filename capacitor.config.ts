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
      // iOS only (Android ignores `resize` entirely — see KeyboardPlugin.java).
      // 'native' resizes the WKWebView itself, so `100dvh` shrinks with the
      // keyboard and the app shell (App.tsx) follows. 'body' only set a pixel
      // height on <body>, which a viewport-unit layout never reads.
      resize: 'native',
      // MUST stay false. This is the legacy immersive-fullscreen hack: while the
      // keyboard is up it pins a FIXED PIXEL height on the activity's content
      // view (Keyboard.java → possiblyResizeChildOfContent), and the only code
      // that restores it is the WindowInsetsAnimation callback — the inset
      // LISTENER never resets it. If the keyboard goes away without that
      // animation firing (app backgrounded mid-typing, Google sign-in, Samsung's
      // dismiss gesture), the WebView stays a keyboard-height short FOREVER: the
      // app renders correctly inside a viewport that ends mid-screen, with the
      // bottom nav floating above a blank strip. We are edge-to-edge, not
      // fullscreen, and Capacitor 8's own SystemBars already handles the IME
      // inset — this only fought it.
      resizeOnFullScreen: false,
    },
  },
};

export default config;
