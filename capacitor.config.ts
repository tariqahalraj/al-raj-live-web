import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.tariqahalraj.live',
  appName: 'Tariqah al-Raj',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    captureInput: false,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    CapacitorUpdater: {
      autoUpdate: false,
      resetWhenUpdate: false,
    },
  },
};

export default config;
