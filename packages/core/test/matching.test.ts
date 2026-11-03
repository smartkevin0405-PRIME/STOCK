import { describe, expect, it } from 'vitest';
import { marketFillPrice, tryFill } from '../src';
import { order, quote } from './fixtures';

describe('시장가 체결 가격', () => {
  it('호가 없으면 슬리피지를 불리하게 적용 후 호가단위로', () => {
    expect(marketFillPrice('KR', 'buy', quote('005930', 70_000))).toBe(70_100);
    expect(marketFillPrice('KR', 'sell', quote('005930', 70_000))).toBe(69_900);
    expect(marketFillPrice('US', 'buy', quote('AAPL', 200))).toBe(200.1);
  });

  it('호가 있으면 매수=매도1호가, 매도=매수1호가', () => {
    const q = quote('005930', 70_000, 70_000, { ask: 70_100, bid: 69_900 });
    expect(marketFillPrice('KR', 'buy', q)).toBe(70_100);
    expect(marketFillPrice('KR', 'sell', q)).toBe(69_900);
  });

  it('상한가를 넘지 않음', () => {
    expect(marketFillPrice('KR', 'buy', quote('005930', 93_600, 72_000))).toBe(93_600);
  });
});

describe('체결', () => {
  it('장 닫혀 있으면 체결 안 됨', () => {
    expect(tryFill({ order: order({ side: 'buy', type: 'market', qty: 1 }), quote: quote('005930', 70_000), marketOpen: false, mode: 'taker' })).toBeNull();
  });

  it('시장가 매수 체결 + 수수료', () => {
    const f = tryFill({ order: order({ side: 'buy', type: 'market', qty: 10 }), quote: quote('005930', 70_000), marketOpen: true, mode: 'taker', now: 1 });
    expect(f).toMatchObject({ price: 70_100, qty: 10, amount: 701_000, commission: 105, tax: 0, currency: 'KRW', executedAt: 1 });
  });

  it('대기 중 지정가 매수: 가격이 닿으면 지정가로 체결', () => {
    const o = order({ side: 'buy', type: 'limit', qty: 1, limitPrice: 69_500 });
    expect(tryFill({ order: o, quote: quote('005930', 69_600), marketOpen: true, mode: 'resting' })).toBeNull();
    expect(tryFill({ order: o, quote: quote('005930', 69_400), marketOpen: true, mode: 'resting' })?.price).toBe(69_500);
  });

  it('주문 즉시 체결 가능한 지정가는 더 유리한 시장 가격으로', () => {
    const o = order({ side: 'buy', type: 'limit', qty: 1, limitPrice: 71_000 });
    expect(tryFill({ order: o, quote: quote('005930', 70_000), marketOpen: true, mode: 'taker' })?.price).toBe(70_100);
  });

  it('지정가 매도 + 거래세', () => {
    const o = order({ side: 'sell', type: 'limit', qty: 10, limitPrice: 80_000 });
    expect(tryFill({ order: o, quote: quote('005930', 79_900), marketOpen: true, mode: 'resting' })).toBeNull();
    expect(tryFill({ order: o, quote: quote('005930', 80_100), marketOpen: true, mode: 'resting' })).toMatchObject({
      price: 80_000, amount: 800_000, commission: 120, tax: 1_600,
    });
  });

  it('취소된 주문은 체결 안 됨', () => {
    const o = order({ side: 'buy', type: 'market', qty: 1, status: 'cancelled' });
    expect(tryFill({ order: o, quote: quote('005930', 70_000), marketOpen: true, mode: 'taker' })).toBeNull();
  });
});
