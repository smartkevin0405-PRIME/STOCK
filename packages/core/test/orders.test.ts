import { describe, expect, it } from 'vitest';
import { validateOrder } from '../src';
import { APPLE, SAMSUNG, quote } from './fixtures';

const cash = { KRW: 10_000_000, USD: 0 };

describe('주문 검사', () => {
  it('정상 지정가 매수 → 예상 금액', () => {
    const r = validateOrder(
      { stock: SAMSUNG, side: 'buy', type: 'limit', qty: 10, limitPrice: 70_000 },
      { quote: quote('005930', 70_000), cash },
    );
    expect(r).toEqual({
      ok: true,
      estimate: { price: 70_000, amount: 700_000, commission: 105, tax: 0, total: 700_105, currency: 'KRW' },
    });
  });

  it('수량은 1 이상 정수', () => {
    for (const qty of [0, -1, 1.5]) {
      const r = validateOrder({ stock: SAMSUNG, side: 'buy', type: 'market', qty }, { quote: quote('005930', 70_000), cash });
      expect(r.ok === false && r.code).toBe('INVALID_QTY');
    }
  });

  it('호가단위 안 맞으면 거부', () => {
    const r = validateOrder(
      { stock: SAMSUNG, side: 'buy', type: 'limit', qty: 1, limitPrice: 70_050 },
      { quote: quote('005930', 70_000), cash },
    );
    expect(r.ok === false && r.code).toBe('INVALID_TICK');
  });

  it('가격제한폭 밖이면 거부', () => {
    const r = validateOrder(
      { stock: SAMSUNG, side: 'buy', type: 'limit', qty: 1, limitPrice: 93_700 },
      { quote: quote('005930', 72_000, 72_000), cash },
    );
    expect(r.ok === false && r.code).toBe('PRICE_LIMIT');
  });

  it('돈이 모자라면 거부 (걸어둔 매수 금액 포함)', () => {
    const r = validateOrder(
      { stock: SAMSUNG, side: 'buy', type: 'limit', qty: 100, limitPrice: 70_000 },
      { quote: quote('005930', 70_000), cash, pendingBuyAmount: 3_500_000 },
    );
    expect(r.ok === false && r.code).toBe('INSUFFICIENT_CASH');
  });

  it('달러 없으면 환전 안내', () => {
    const r = validateOrder({ stock: APPLE, side: 'buy', type: 'market', qty: 1 }, { quote: quote('AAPL', 200), cash });
    expect(r.ok === false && r.message).toContain('환전');
  });

  it('보유보다 많이 팔면 거부 (걸어둔 매도 수량 포함)', () => {
    const r = validateOrder(
      { stock: SAMSUNG, side: 'sell', type: 'market', qty: 5 },
      { quote: quote('005930', 70_000), cash, position: { code: '005930', qty: 8, avgPrice: 60_000, currency: 'KRW' }, pendingSellQty: 4 },
    );
    expect(r.ok === false && r.code).toBe('INSUFFICIENT_QTY');
  });

  it('매도 예상금액은 수수료·세금 차감', () => {
    const r = validateOrder(
      { stock: SAMSUNG, side: 'sell', type: 'limit', qty: 10, limitPrice: 70_000 },
      { quote: quote('005930', 70_000), cash, position: { code: '005930', qty: 10, avgPrice: 60_000, currency: 'KRW' } },
    );
    expect(r.ok && r.estimate.total).toBe(700_000 - 105 - 1_400);
  });
});
