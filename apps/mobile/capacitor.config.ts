import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.videoplat.camera',
  appName: 'Câmera VideoPlat',
  webDir: 'web',
  backgroundColor: '#0f0f0f',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0f0f0f',
  },
};

export default config;
