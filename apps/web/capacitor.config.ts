import type { CapacitorConfig } from '@capacitor/cli';

// 안드로이드 앱(APK) 설정. 서버 주소는 앱 안에서 입력 (lib/server.ts)
const config: CapacitorConfig = {
  appId: 'app.stockmock.android',
  appName: 'STOCK',
  webDir: 'dist',
  server: {
    // http:// 서버(집 PC 등)도 쓸 수 있게
    cleartext: true,
  },
  android: {
    // 앱 화면은 https://localhost 라서 http 서버에 붙으려면 필요
    allowMixedContent: true,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
