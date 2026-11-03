import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const recentKeys = new Map<string, number>();

function emit() {
  for (const l of listeners) l();
}

/** 화면 아래 잠깐 뜨는 알림. key가 같으면 5초 안에 한 번만 */
export function toast(text: string, tone: Toast['tone'] = 'info', key?: string) {
  const now = Date.now();
  if (key) {
    if ((recentKeys.get(key) ?? 0) > now - 5_000) return;
    recentKeys.set(key, now);
  }
  const id = ++seq;
  toasts = [...toasts.slice(-2), { id, text, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 3_500);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}
