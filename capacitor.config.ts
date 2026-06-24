import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fivocrm.app',
  appName: 'FivoCRM',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
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
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
