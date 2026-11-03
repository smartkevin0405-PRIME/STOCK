import type { Candle } from '@stock/shared';

/** 봉 묶기 (예: 1분봉 → 5분봉, 일봉 → 주봉). bucket은 봉 시작 시각(초)을 돌려줌 */
export function aggregateCandles(candles: readonly Candle[], bucket: (time: number) => number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const t = bucket(c.time);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ ...c, time: t });
    }
  }
  return out;
}

export const byMinutes = (n: number) => (time: number) => Math.floor(time / (n * 60)) * n * 60;

/** 월요일 시작 주 (UTC 날짜 기준) */
export function byWeek(time: number): number {
  const d = new Date(time * 1000);
  const dow = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) / 1000;
}

export function byMonth(time: number): number {
  const d = new Date(time * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}
