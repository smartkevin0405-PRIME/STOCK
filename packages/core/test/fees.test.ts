import { describe, expect, it } from 'vitest';
import { calcCosts, quoteFx } from '../src';

describe('수수료·세금', () => {
  it('국내 매수는 수수료만', () => {
    expect(calcCosts('KR', 'buy', 1_000_000)).toEqual({ commission: 150, tax: 0 });
  });

  it('국내 매도는 수수료 + 거래세 0.20%', () => {
    expect(calcCosts('KR', 'sell', 1_000_000)).toEqual({ commission: 150, tax: 2_000 });
  });

  it('원 미만은 절사', () => {
    expect(calcCosts('KR', 'buy', 333)).toEqual({ commission: 0, tax: 0 });
    expect(calcCosts('KR', 'sell', 12_345)).toEqual({ commission: 1, tax: 24 });
  });

  it('미국은 0.25%, 센트 단위', () => {
    expect(calcCosts('US', 'buy', 1_000)).toEqual({ commission: 2.5, tax: 0 });
    expect(calcCosts('US', 'buy', 187.23)).toEqual({ commission: 0.47, tax: 0 });
  });
});

describe('환전', () => {
  it('원→달러는 기준환율 +1%, 받는 달러는 센트 절사', () => {
    expect(quoteFx('KRW', 1_000_000, 1_400)).toEqual({ from: 'KRW', to: 'USD', rate: 1_414, pay: 1_000_000, receive: 707.21 });
  });

  it('달러→원은 기준환율 -1%', () => {
    expect(quoteFx('USD', 100, 1_400)).toEqual({ from: 'USD', to: 'KRW', rate: 1_386, pay: 100, receive: 138_600 });
  });
});
