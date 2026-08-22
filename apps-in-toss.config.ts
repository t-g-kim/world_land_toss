import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // 앱인토스 콘솔에 등록한 appName과 반드시 일치해야 함 (등록 후 변경 불가)
  // 콘솔 미니앱: "건물주" (miniAppId 67347, workspace 82293)
  appName: 'landmark',
  brand: {
    primaryColor: '#4f46e5',
  },
  webView: {},
  permissions: [
    // 📍 내 위치(홈 선택·이동)에 사용
    { name: 'geolocation', access: 'access' },
  ],
  webBundleDir: 'dist',
});
