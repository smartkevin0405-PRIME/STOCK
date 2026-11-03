import { useSyncExternalStore } from 'react';

/** checking: 서버 확인 중 / in: 앱 사용 / out: 로그인 화면 */
export type AuthState = 'checking' | 'in' | 'out';

const KEY = 'auth-token';
let state: AuthState = 'checking';
let required = false;
// localStorage가 막힌 환경에선 메모리에만
let memory: string | null = null;
const listeners = new Set<() => void>();

function setState(s: AuthState) {
  state = s;
  for (const l of listeners) l();
}

function saveToken(token: string | null) {
  memory = token;
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // 저장 못 해도 이번 실행 동안은 동작
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

/** 서버 헬스체크로 로그인이 필요한지 정함 (서버 연결 실패 땐 일단 앱 표시) */
export function initAuth(authOn: boolean) {
  required = authOn;
  setState(authOn && !getToken() ? 'out' : 'in');
}

export function loggedIn(token: string) {
  saveToken(token);
  required = true;
  setState('in');
}

export function logout() {
  saveToken(null);
  setState('out');
}

/** 서버가 401을 주면 로그인 화면으로 */
export function unauthorized() {
  required = true;
  if (state === 'out') return;
  saveToken(null);
  setState('out');
}

/** 서버에 비밀번호가 설정돼 있는지 (더보기의 로그아웃 표시용) */
export function authRequired(): boolean {
  return required;
}

export function getAuthState(): AuthState {
  return state;
}

export function useAuthState(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
