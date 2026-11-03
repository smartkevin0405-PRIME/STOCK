import type { Market } from '@stock/shared';
import { DEFAULT_CONFIG } from './config';

// KRX 호가가격단위 (2023.1 개편, 코스피·코스닥 통일): [이 가격 미만, 호가단위]
const KR_TICKS: ReadonlyArray<readonly [number, number]> = [
  [2_000, 1],
  [5_000, 5],
  [20_000, 10],
  [50_000, 50],
  [200_000, 100],
  [500_000, 500],
  [Infinity, 1_000],
];

export function tickSize(market: Market, price: number): number {
  if (market === 'US') return price >= 1 ? 0.01 : 0.0001;
  for (const [below, tick] of KR_TICKS) {
    if (price < below) return tick;
  }
  return 1_000;
}

export type TickRound = 'down' | 'up' | 'nearest';

/** 부동소수 오차 제거 (예: 1234.4999999 → 1234.5) */
function clean(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function roundToTick(market: Market, price: number, mode: TickRound = 'nearest'): number {
  const tick = tickSize(market, price);
  const units = clean(price / tick);
  const rounded = mode === 'down' ? Math.floor(units) : mode === 'up' ? Math.ceil(units) : Math.round(units);
  const result = clean(rounded * tick);
  // 올림으로 다음 가격대에 들어가도 경계값은 항상 그 가격대의 호가단위 배수라 안전
  return market === 'US' ? Number(result.toFixed(4)) : result;
}

export function isValidTick(market: Market, price: number): boolean {
  if (!(price > 0)) return false;
  return Math.abs(roundToTick(market, price, 'nearest') - price) < 1e-9;
}

export interface PriceLimits {
  upper: number;
  lower: number;
}

/** 국내 상·하한가. 미국은 가격제한폭이 없어서 null */
export function priceLimits(
  market: Market,
  prevClose: number,
  rate = DEFAULT_CONFIG.krPriceLimitRate,
): PriceLimits | null {
  if (market === 'US') return null;
  return {
    upper: roundToTick('KR', prevClose * (1 + rate), 'down'),
    lower: roundToTick('KR', prevClose * (1 - rate), 'up'),
  };
}
