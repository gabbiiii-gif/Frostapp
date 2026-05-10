import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.frosterp.app',
  appName: 'FrostERP',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  // Live reload local: descomenta + ajusta IP do PC + cap sync android.
  // NUNCA commitar com server.url ativo — APK production vai falhar.
  // server: {
  //   url: 'http://192.168.1.80:5173',
  //   cleartext: true,
  //   androidScheme: 'http',
  // },
  ios: {
    contentInset: 'always',
    scheme: 'FrostERP',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      launchFadeOutDuration: 300,
      backgroundColor: '#0A1628',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0A1628',
      overlaysWebView: false,
    },
    Camera: {
      saveToGallery: false,
    },
  },
};

export default config;
