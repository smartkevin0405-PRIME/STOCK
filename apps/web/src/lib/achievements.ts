import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { AchievementMessage } from './live';
import { toast } from './toast';

let version = 0;
const listeners = new Set<() => void>();

function bump() {
  version++;
  for (const l of listeners) l();
}

/** 새로 달성하면 토스트 + 업적 화면 다시 불러오기 */
export function handleAchievement(m: AchievementMessage) {
  toast(m.kind === 'challenge' ? `🎯 챌린지 달성: ${m.title}` : `🏆 업적 달성: ${m.title}`, 'info', `achievement:${m.id}`);
  bump();
}

/** 달성 알림이 올 때마다 바뀌는 값 (useAsync deps용) */
export function useAchievementVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

/** 손절 기준 저장 (예: -0.05). null이면 해제 */
export async function saveStopLossRate(rate: number | null): Promise<number | null> {
  const { stopLossRate } = await api.saveSettings({ stopLossRate: rate });
  bump();
  return stopLossRate;
}
