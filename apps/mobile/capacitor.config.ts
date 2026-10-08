import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.videoplat.camera',
  appName: 'Câmera VideoPlat',
  webDir: 'web',
  backgroundColor: '#0f0f0f',
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      fadeOutDuration: 0,
      showSpinner: false,
      backgroundColor: '#0f0f0f',
    },
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0f0f0f',
  },
};

export default config;