import { useCallback, useSyncExternalStore } from 'react';

// localStorage는 사생활 보호 모드 등에서 막힐 수 있어서 항상 try/catch
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const listeners = new Set<() => void>();
const cache = new Map<string, unknown>();

/** 브라우저에 저장되는 값 (화면 간 공유) */
export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      if (!cache.has(key)) cache.set(key, read(key, fallback));
      return cache.get(key) as T;
    },
  );
  const set = useCallback(
    (v: T) => {
      cache.set(key, v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // 저장 실패해도 화면은 동작
      }
      for (const l of listeners) l();
    },
    [key],
  );
  return [value, set];
}
