import { App as CapApp } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { api } from './api';
import { isNative } from './server';

/** 안드로이드 앱(APK) 전용: 뒤로가기 버튼, FCM 푸시 */

export type NativePushState = 'no-firebase' | 'server-off' | 'denied' | 'off' | 'on';

/** 서버 fcm.ts의 FCM_CHANNEL과 같은 값 */
const CHANNEL = 'alerts';
const TOKEN_KEY = 'stock.fcmToken';

/** 앱에 google-services.json이 들어갔는지 (MainActivity의 FcmSetupPlugin). 없이 등록하면 앱이 꺼짐 */
const FcmSetup = registerPlugin<{ available(): Promise<{ available: boolean }> }>('FcmSetup');

async function firebaseReady(): Promise<boolean> {
  try {
    return (await FcmSetup.available()).available;
  } catch {
    return false;
  }
}

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 저장 못 해도 알림은 동작
  }
}

/** FCM 토큰 받기 (register 결과는 이벤트로 옴) */
async function fetchToken(): Promise<string> {
  await PushNotifications.createChannel({ id: CHANNEL, name: '가격 알림', description: '가격 알림과 주문 체결', importance: 4, visibility: 1 }).catch(() => undefined);
  return new Promise<string>((resolve, reject) => {
    const handles: Promise<{ remove: () => Promise<void> }>[] = [];
    const done = () => handles.forEach((h) => void h.then((x) => x.remove()));
    const timer = setTimeout(() => {
      done();
      reject(new Error('푸시 등록 응답이 없어요. 잠시 후 다시 시도해주세요'));
    }, 20_000);
    handles.push(
      PushNotifications.addListener('registration', ({ value }) => {
        clearTimeout(timer);
        done();
        resolve(value);
      }),
      PushNotifications.addListener('registrationError', ({ error }) => {
        clearTimeout(timer);
        done();
        reject(new Error(`푸시 등록 실패: ${error}`));
      }),
    );
    void PushNotifications.register();
  });
}

export async function nativePushState(): Promise<NativePushState> {
  if (!(await firebaseReady())) return 'no-firebase';
  const info = await api.fcmInfo().catch(() => ({ enabled: false }));
  if (!info.enabled) return 'server-off';
  const { receive } = await PushNotifications.checkPermissions();
  if (receive === 'denied') return 'denied';
  return receive === 'granted' && storedToken() ? 'on' : 'off';
}

export async function enableNativePush(): Promise<void> {
  const { receive } = await PushNotifications.requestPermissions();
  if (receive !== 'granted') throw new Error('알림 권한이 허용되지 않았어요. 폰 설정 → 앱 → STOCK → 알림에서 허용해주세요');
  const token = await fetchToken();
  await api.fcmRegister(token);
  storeToken(token);
}

export async function disableNativePush(): Promise<void> {
  const token = storedToken();
  if (token) await api.fcmUnregister(token).catch(() => undefined);
  storeToken(null);
  await PushNotifications.unregister();
}

/** 알림 누르면 해당 화면으로 (서버가 보낸 url: /#/stock/005930) */
function openUrl(url: unknown): void {
  if (typeof url !== 'string') return;
  const i = url.indexOf('#');
  if (i >= 0) window.location.hash = url.slice(i);
}

/** 앱 시작 때 한 번: 뒤로가기, 알림 누름 처리, 켜둔 푸시 토큰을 서버와 다시 맞춤 */
export async function initNative(): Promise<void> {
  if (!isNative()) return;
  void CapApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else void CapApp.exitApp();
  });
  if (!(await firebaseReady())) return;
  void PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => openUrl(notification.data?.url));
  // 토큰은 바뀔 수 있고, 서버가 지웠을 수도 있어서 켜둔 상태면 매번 다시 등록
  if (!storedToken()) return;
  const { receive } = await PushNotifications.checkPermissions();
  if (receive !== 'granted') return;
  try {
    const token = await fetchToken();
    await api.fcmRegister(token);
    storeToken(token);
  } catch {
    // 서버에 FCM 설정이 없거나 연결 안 됨 → 다음 실행 때 다시
  }
}
