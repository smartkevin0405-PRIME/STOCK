import type { Fill } from '@stock/shared';
import { describe, expect, it } from 'vitest';
import { applyFill } from '../src/portfolio';
import type { AccountState } from '../src/portfolio';
import { buildClosedTrades, calcMaxDrawdown, calcTradeStats } from '../src/stats';

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-02T00:00:00Z');

function fill(side: Fill['side'], price: number, qty: number, day: number, extra: Partial<Fill> = {}): Fill {
  const code = extra.code ?? '005930';
  return {
    orderId: `${side}-${day}`,
    code,
    side,
    price,
    qty,
    amount: price * qty,
    commission: 0,
    tax: 0,
    currency: code === 'AAPL' ? 'USD' : 'KRW',
    executedAt: T0 + day * DAY,
    ...extra,
  };
}

describe('청산 거래 만들기', () => {
  it('매수 → 전량 매도: 손익·수익률·보유기간', () => {
    const [t] = buildClosedTrades([fill('buy', 10_000, 10, 0, { commission: 15 }), fill('sell', 11_000, 10, 3, { commission: 16, tax: 220 })]);
    expect(t).toMatchObject({ code: '005930', qty: 10, entryPrice: 10_000, exitPrice: 11_000, cost: 100_000 });
    expect(t!.pnl).toBe(110_000 - 100_000 - 15 - 16 - 220);
    expect(t!.pnlRate).toBeCloseTo(9_749 / 100_000);
    expect(t!.priceRate).toBeCloseTo(0.1);
    expect(t!.holdingMs).toBe(3 * DAY);
  });

  it('평균단가는 계좌(applyFill)와 같고, 차이는 매수 수수료뿐', () => {
    const fills = [
      fill('buy', 70_000, 10, 0, { commission: 105 }),
      fill('buy', 60_000, 10, 1, { commission: 90 }),
      fill('sell', 66_000, 5, 2, { commission: 49, tax: 660 }),
    ];
    let s: AccountState = { cash: { KRW: 10_000_000, USD: 0 }, positions: {} };
    let realized = 0;
    for (const f of fills) {
      const r = applyFill(s, f);
      s = r;
      realized = r.realizedPnl;
    }
    const [t] = buildClosedTrades(fills);
    expect(t!.entryPrice).toBe(65_000);
    // 매수 수수료 (105 + 90)의 1/4
    expect(t!.pnl).toBeCloseTo(realized - 195 / 4, 0);
  });

  it('분할 매도: 보유기간은 먼저 산 주식부터 (FIFO) 수량 가중', () => {
    const trades = buildClosedTrades([
      fill('buy', 100, 10, 0),
      fill('buy', 100, 10, 4),
      fill('sell', 100, 15, 10), // 10주(10일) + 5주(6일)
      fill('sell', 100, 5, 12), // 5주(8일)
    ]);
    expect(trades).toHaveLength(2);
    expect(trades[0]!.holdingMs).toBe(((10 * 10 + 5 * 6) / 15) * DAY);
    expect(trades[0]!.openedAt).toBe(T0);
    expect(trades[1]!.holdingMs).toBe(8 * DAY);
    expect(trades[1]!.openedAt).toBe(T0 + 4 * DAY);
  });

  it('입력 순서가 섞여 있어도 체결 시각 순으로 처리', () => {
    const trades = buildClosedTrades([fill('sell', 120, 1, 2), fill('buy', 100, 1, 0)]);
    expect(trades[0]!.pnl).toBe(20);
  });

  it('보유 수량보다 많이 팔면 에러', () => {
    expect(() => buildClosedTrades([fill('buy', 100, 1, 0), fill('sell', 100, 2, 1)])).toThrow();
  });

  it('달러 종목은 센트 단위로 반올림', () => {
    const [t] = buildClosedTrades([
      fill('buy', 200.123, 3, 0, { code: 'AAPL', amount: 600.369 }),
      fill('sell', 210, 3, 1, { code: 'AAPL', commission: 1.58 }),
    ]);
    expect(t!.currency).toBe('USD');
    expect(t!.pnl).toBe(28.05);
  });
});

describe('매매 통계', () => {
  const trades = buildClosedTrades([
    fill('buy', 100, 10, 0),
    fill('sell', 120, 10, 1), // +200
    fill('buy', 100, 10, 2),
    fill('sell', 90, 10, 4), // -100
    fill('buy', 100, 10, 5),
    fill('sell', 110, 10, 8), // +100
    fill('buy', 100, 10, 9),
    fill('sell', 100, 10, 10), // 0
    fill('buy', 100, 10, 11),
    fill('sell', 70, 10, 12), // -300
  ]);

  it('승률·평균 수익/손실·손익비', () => {
    const s = calcTradeStats(trades);
    expect(s).toMatchObject({ count: 5, wins: 2, losses: 2, breakeven: 1, winRate: 0.4 });
    expect(s).toMatchObject({ totalPnlKrw: -100, grossProfitKrw: 300, grossLossKrw: -400, avgWinKrw: 150, avgLossKrw: -200 });
    expect(s.payoffRatio).toBeCloseTo(0.75);
    expect(s.profitFactor).toBeCloseTo(0.75);
    expect(s.avgWinRate).toBeCloseTo(0.15);
    expect(s.avgLossRate).toBeCloseTo(-0.2);
  });

  it('최대 연승·연패 (본전은 연속을 끊음)', () => {
    const s = calcTradeStats(trades);
    expect(s.maxWinStreak).toBe(1);
    expect(s.maxLossStreak).toBe(1);
    const streak = calcTradeStats(
      buildClosedTrades([0, 2, 4].flatMap((d) => [fill('buy', 100, 1, d), fill('sell', 101, 1, d + 1)])),
    );
    expect(streak.maxWinStreak).toBe(3);
  });

  it('보유기간 평균·중앙값·최소·최대 (일)', () => {
    expect(calcTradeStats(trades).holding).toEqual({ avgDays: 1.6, medianDays: 1, minDays: 1, maxDays: 3 });
  });

  it('거래가 없으면 비율은 null', () => {
    const s = calcTradeStats([]);
    expect(s).toMatchObject({ count: 0, winRate: null, payoffRatio: null, profitFactor: null, holding: null });
  });

  it('손실 거래가 없으면 손익비 null, 수익 거래가 없으면 0', () => {
    const allWin = calcTradeStats(buildClosedTrades([fill('buy', 100, 1, 0), fill('sell', 110, 1, 1)]));
    expect(allWin.payoffRatio).toBeNull();
    const allLoss = calcTradeStats(buildClosedTrades([fill('buy', 100, 1, 0), fill('sell', 90, 1, 1)]));
    expect(allLoss.payoffRatio).toBe(0);
    expect(allLoss.profitFactor).toBe(0);
  });

  it('달러 거래는 환율로 원화 환산, 환율 없으면 에러', () => {
    const usd = buildClosedTrades([fill('buy', 100, 1, 0, { code: 'AAPL' }), fill('sell', 110, 1, 1, { code: 'AAPL' })]);
    expect(calcTradeStats(usd, { usdKrw: 1400 }).totalPnlKrw).toBe(14_000);
    expect(() => calcTradeStats(usd)).toThrow(/환율/);
  });
});

describe('최대 낙폭 (MDD)', () => {
  const pts = (values: number[]) => values.map((value, i) => ({ time: i, value }));

  it('고점 대비 가장 큰 하락', () => {
    const r = calcMaxDrawdown(pts([100, 120, 90, 110, 130, 104, 125]))!;
    expect(r.mdd).toBeCloseTo(-0.25); // 120 → 90
    expect(r).toMatchObject({ peakTime: 1, peakValue: 120, troughTime: 2, troughValue: 90, recoveredTime: 4 });
    expect(r.current).toBeCloseTo(125 / 130 - 1);
  });

  it('회복 못 했으면 recoveredTime null', () => {
    const r = calcMaxDrawdown(pts([100, 80, 95]))!;
    expect(r.mdd).toBeCloseTo(-0.2);
    expect(r.recoveredTime).toBeNull();
    expect(r.current).toBeCloseTo(-0.05);
  });

  it('계속 오르기만 하면 0', () => {
    expect(calcMaxDrawdown(pts([100, 110, 120]))).toMatchObject({ mdd: 0, current: 0, recoveredTime: null });
  });

  it('시간 순서가 섞여 있어도 정렬해서 계산', () => {
    expect(calcMaxDrawdown([{ time: 2, value: 50 }, { time: 1, value: 100 }])!.mdd).toBeCloseTo(-0.5);
  });

  it('데이터가 없으면 null', () => {
    expect(calcMaxDrawdown([])).toBeNull();
  });
});
