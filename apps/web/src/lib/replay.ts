import { replayDayTime } from '@stock/core';
import type { Candle, ReplayResult, ReplayScenario, ReplayScenariosResponse, StockInfo } from '@stock/shared';
import { ApiError, apiFetch } from './api';

// 타임머신 리플레이 API (본 계좌와 분리)

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(data.error ?? `요청 실패 (${res.status})`, res.status, data.code);
  return data;
}

const DAY_MS = 86_400_000;

export const replayApi = {
  scenarios: () => call<ReplayScenariosResponse>('/api/replay/scenarios'),
  history: (code: string, from: number, to: number) =>
    call<{ stock: StockInfo; candles: Candle[] }>(`/api/replay/history?code=${encodeURIComponent(code)}&from=${from}&to=${to}`),
  results: (scenarioId?: string) =>
    call<{ results: ReplayResult[] }>(`/api/replay/results${scenarioId ? `?scenarioId=${encodeURIComponent(scenarioId)}` : ''}`),
  saveResult: (r: Omit<ReplayResult, 'id' | 'startCash'>) =>
    call<{ result: ReplayResult }>('/api/replay/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    }),
};

/** 시나리오에 필요한 일봉 기간 (시작 전 lookback 봉이 넉넉히 들어오게 달력 기준으로 더 받음) */
export function scenarioRange(s: ReplayScenario): { from: number; to: number } {
  const from = replayDayTime(s.start) * 1000 - Math.ceil(s.lookbackDays * 1.6 + 14) * DAY_MS;
  const to = replayDayTime(s.end) * 1000 + DAY_MS - 1;
  return { from, to };
}

/** 일봉 time(UTC 자정) → '2020년 3월 19일 (목)' */
export function replayDateText(time: number, withWeekday = true): string {
  return new Date(time * 1000).toLocaleDateString('ko-KR', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(withWeekday ? { weekday: 'short' } : {}),
  });
}

/** '2020-02-03' → '2020.02.03' */
export const dotDate = (d: string) => d.replaceAll('-', '.');
