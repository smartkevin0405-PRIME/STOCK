import { api } from './api';

export type PushState = 'unsupported' | 'needs-install' | 'insecure' | 'denied' | 'off' | 'on';

/** 아이폰은 '홈 화면에 추가'한 앱에서만 푸시 가능 */
function isIosBrowser(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/** 이 기기에서 푸시를 켤 수 있는지, 켜져 있는지 */
export async function pushState(): Promise<PushState> {
  if (!window.isSecureContext) return 'insecure';
  if (isIosBrowser()) return 'needs-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** 서버가 준 공개키(base64url) → 브라우저가 원하는 바이트 */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('알림 권한이 허용되지 않았어요. 브라우저 설정에서 허용해주세요');
  const { publicKey } = await api.pushInfo();
  if (!publicKey) throw new Error('서버에 푸시 설정이 없어요');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api.pushSubscribe(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint);
  await sub.unsubscribe();
}

/** 앱 시작 때 서비스 워커 등록 (홈 화면 설치·푸시 준비) */
export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }
}
