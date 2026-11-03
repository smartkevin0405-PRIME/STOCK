import type { Currency } from '@stock/shared';

export type RoundMode = 'floor' | 'ceil' | 'round';

const EPS = 1e-6;

/** 원화는 1원, 달러는 1센트 단위로 반올림/절사 */
export function roundMoney(amount: number, currency: Currency, mode: RoundMode = 'floor'): number {
  const scale = currency === 'KRW' ? 1 : 100;
  const v = amount * scale;
  let r: number;
  if (mode === 'floor') r = Math.floor(v + EPS);
  else if (mode === 'ceil') r = Math.ceil(v - EPS);
  else r = Math.round(v + (v >= 0 ? EPS : -EPS));
  return r / scale;
}
