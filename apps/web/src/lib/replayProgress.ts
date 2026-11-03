import type { ReplayProgress } from '@stock/core';

// 리플레이 진행은 이 기기 브라우저에만 저장 (막혀 있으면 저장 없이 그냥 진행)
const key = (scenarioId: string) => `replay.progress.${scenarioId}`;

export function loadReplayProgress(scenarioId: string): unknown {
  try {
    const raw = localStorage.getItem(key(scenarioId));
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function saveReplayProgress(p: ReplayProgress): void {
  try {
    localStorage.setItem(key(p.scenarioId), JSON.stringify(p));
  } catch {
    // 저장 못 해도 진행은 계속
  }
}

export function clearReplayProgress(scenarioId: string): void {
  try {
    localStorage.removeItem(key(scenarioId));
  } catch {
    // 무시
  }
}

/** 목록에서 '이어하기' 표시용: 저장된 날짜 (일봉 time) */
export function savedReplayTime(scenarioId: string): number | undefined {
  const p = loadReplayProgress(scenarioId) as Partial<ReplayProgress> | null;
  return p && p.v === 1 && typeof p.time === 'number' ? p.time : undefined;
}
