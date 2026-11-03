import type { Fill } from '@stock/shared';
import { describe, expect, it } from 'vitest';
import { applyFill, evaluatePortfolio } from '../src';
import type { AccountState } from '../src';
import { quote } from './fixtures';

function fill(side: Fill['side'], price: number, qty: number, commission = 0, tax = 0, code = '005930'): Fill {
  return { orderId: 'x', code, side, price, qty, amount: price * qty, commission, tax, currency: code === 'AAPL' ? 'USD' : 'KRW', executedAt: 0 };
}

const start: AccountState = { cash: { KRW: 10_000_000, USD: 0 }, positions: {} };

describe('계좌 반영', () => {
  it('분할 매수 → 평균단가', () => {
    let s = applyFill(start, fill('buy', 70_000, 10, 105));
    s = applyFill(s, fill('buy', 60_000, 10, 90));
    expect(s.positions['005930']).toEqual({ code: '005930', qty: 20, avgPrice: 65_000, currency: 'KRW' });
    expect(s.cash.KRW).toBe(10_000_000 - 700_105 - 600_090);
  });

  it('일부 매도 → 실현손익, 평균단가 유지', () => {
    let s = applyFill(start, fill('buy', 65_000, 20));
    s = applyFill(s, fill('sell', 80_000, 5, 60, 800));
    expect(s.realizedPnl).toBe((80_000 - 65_000) * 5 - 60 - 800);
    expect(s.positions['005930']?.qty).toBe(15);
    expect(s.positions['005930']?.avgPrice).toBe(65_000);
  });

  it('전량 매도하면 보유 목록에서 빠짐', () => {
    let s = applyFill(start, fill('buy', 65_000, 2));
    s = applyFill(s, fill('sell', 65_000, 2));
    expect(s.positions['005930']).toBeUndefined();
  });

  it('보유보다 많이 팔면 에러', () => {
    expect(() => applyFill(start, fill('sell', 65_000, 1))).toThrow();
  });

  it('원본 상태는 그대로', () => {
    applyFill(start, fill('buy', 70_000, 1));
    expect(start.cash.KRW).toBe(10_000_000);
    expect(start.positions).toEqual({});
  });
});

describe('평가', () => {
  it('원화+달러 합산 총자산', () => {
    const state: AccountState = {
      cash: { KRW: 1_000_000, USD: 100 },
      positions: {
        '005930': { code: '005930', qty: 10, avgPrice: 60_000, currency: 'KRW' },
        AAPL: { code: 'AAPL', qty: 2, avgPrice: 200, currency: 'USD' },
      },
    };
    const v = evaluatePortfolio(state, { '005930': quote('005930', 70_000), AAPL: quote('AAPL', 210) }, 1_400);
    expect(v.stockValueKrw).toBe(700_000 + 420 * 1_400);
    expect(v.pnlKrw).toBe(100_000 + 20 * 1_400);
    expect(v.totalKrw).toBe(1_000_000 + 100 * 1_400 + 700_000 + 420 * 1_400);
    expect(v.holdings.find((h) => h.code === '005930')?.pnlRate).toBeCloseTo(1 / 6);
  });
});
