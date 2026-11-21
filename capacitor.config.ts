import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.khatabhai.app',
  appName: 'KhataBhai',
  webDir: 'dist',
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: '#f7f4ee', showSpinner: false },
  },
}

export default config
