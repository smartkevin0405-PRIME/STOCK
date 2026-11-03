import { Capacitor } from '@capacitor/core';

/**
 * 서버 주소. 앱(APK) 하나로 어느 서버든 쓸 수 있게 앱 안에 저장.
 * 저장된 값 → 없으면 빌드 때 넣은 VITE_API_BASE → 없으면 같은 주소('')
 */
const KEY = 'stock.server';

export const isNative = (): boolean => Capacitor.isNativePlatform();

function stored(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/** 앞뒤 공백·끝 슬래시 제거, http(s) 없으면 https 붙이기 */
export function normalizeServer(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

/** 서버 없이 쓰기 (시세는 폰이 직접, 계좌는 기기 안에). 'local:mock'은 가짜 시세 (테스트용) */
export const LOCAL = 'local';

function setting(): string {
  return stored() || (import.meta.env.VITE_API_BASE ?? '');
}

export function isLocalMode(): boolean {
  return setting().startsWith(LOCAL);
}

export function isLocalMock(): boolean {
  return setting() === `${LOCAL}:mock`;
}

export function serverBase(): string {
  return isLocalMode() ? '' : setting();
}

/** 앱에서 서버 주소를 아직 안 정했으면 설정 화면부터 */
export function needsServerSetup(): boolean {
  return isNative() && !setting();
}

/** 저장 후 새로고침 (API·실시간 연결이 새 주소로 다시 시작) */
export function saveServer(url: string): void {
  try {
    if (url) localStorage.setItem(KEY, url);
    else localStorage.removeItem(KEY);
  } catch {
    // 저장이 막혀 있으면 이번 실행에서만 못 씀
  }
  window.location.hash = '#/';
  window.location.reload();
}

/** /api/health 로 연결 확인. 문제 있으면 이유를 담은 Error */
export async function testServer(url: string): Promise<void> {
  if (!/^https?:\/\/[^/\s]+/.test(url)) throw new Error('주소 형식이 올바르지 않아요');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
    if (!res.ok || data.ok !== true) throw new Error(`STOCK 서버가 아닌 것 같아요 (${res.status})`);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('응답이 없어요. 주소와 서버가 켜져 있는지 확인해주세요');
    if (e instanceof TypeError) throw new Error('연결하지 못했어요. 주소·인터넷 연결을 확인해주세요');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
