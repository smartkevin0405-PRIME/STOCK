import type { CapacitorConfig } from '@capacitor/cli';

// 안드로이드 앱(APK) 설정. 서버 주소(또는 서버 없이 쓰기)는 앱 안에서 정함 (lib/server.ts)
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
    // 서버 없이 쓸 때 폰이 네이버·야후 시세를 직접 받도록 (브라우저 CORS 제한 없이 기기에서 요청)
    CapacitorHttp: {
      enabled: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
