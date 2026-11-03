import type { Candle } from '@stock/shared';
import { describe, expect, it } from 'vitest';
import {
  closeAt,
  createReplayAccount,
  maxReplayBuyQty,
  replayDayTime,
  replayFillPrice,
  replayOrder,
  replayTimeline,
  trimReplayCandles,
  valueReplayAccount,
  visibleCandles,
} from '../src';

const DAY = 86_400;
const D1 = replayDayTime('2020-03-02');
const candle = (time: number, close: number): Candle => ({ time, open: close, high: close, low: close, close, volume: 0 });
const SAMSUNG = [candle(D1, 70_000), candle(D1 + DAY, 80_000), candle(D1 + 2 * DAY, 30_000)];

describe('리플레이 날짜·봉', () => {
  it('날짜 문자열 → UTC 자정 epoch 초', () => {
    expect(replayDayTime('2020-03-02')).toBe(Date.UTC(2020, 2, 2) / 1000);
  });

  it('지금 날짜까지 봉만 보임 (미래 봉 안 보임)', () => {
    expect(visibleCandles(SAMSUNG, D1 - 1)).toEqual([]);
    expect(visibleCandles(SAMSUNG, D1).map((c) => c.close)).toEqual([70_000]);
    expect(visibleCandles(SAMSUNG, D1 + DAY).map((c) => c.close)).toEqual([70_000, 80_000]);
    expect(closeAt(SAMSUNG, D1 + DAY)).toBe(80_000);
    expect(closeAt(SAMSUNG, D1 - 1)).toBeUndefined();
  });

  it('재생 날짜는 종목들 날짜를 합쳐서 기간 안만', () => {
    const a = [candle(D1, 1), candle(D1 + DAY, 1), candle(D1 + 3 * DAY, 1)];
    const b = [candle(D1 + DAY, 1), candle(D1 + 2 * DAY, 1)];
    expect(replayTimeline([a, b], D1 + DAY, D1 + 3 * DAY)).toEqual([D1 + DAY, D1 + 2 * DAY, D1 + 3 * DAY]);
  });

  it('시작 전 봉은 lookback개만, 끝 이후 봉은 버림', () => {
    const cs = [0, 1, 2, 3, 4, 5, 6].map((i) => candle(D1 + i * DAY, i));
    expect(trimReplayCandles(cs, D1 + 3 * DAY, D1 + 5 * DAY, 2).map((c) => c.close)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('리플레이 주문', () => {
  it('체결가는 종가에 슬리피지를 불리하게 + 호가단위', () => {
    expect(replayFillPrice('KR', 'buy', 70_000)).toBe(70_100);
    expect(replayFillPrice('KR', 'sell', 80_000)).toBe(79_900);
    expect(replayFillPrice('US', 'buy', 100)).toBe(100.05);
  });

  it('국내: 매수 → 다음 날 매도 (수수료·세금·실현손익)', () => {
    const acct = createReplayAccount('KR', 10_000_000);
    const buy = replayOrder(acct, { code: '005930', side: 'buy', qty: 10, candles: SAMSUNG, time: D1 });
    if (!buy.ok) throw new Error(buy.message);
    expect(buy.trade).toMatchObject({ price: 70_100, amount: 701_000, commission: 105, tax: 0 });
    expect(buy.account.cash).toBe(9_298_895);
    expect(buy.account.positions['005930']).toMatchObject({ qty: 10, avgPrice: 70_100 });
    expect(acct.cash).toBe(10_000_000); // 원본은 그대로

    const sell = replayOrder(buy.account, { code: '005930', side: 'sell', qty: 10, candles: SAMSUNG, time: D1 + DAY });
    if (!sell.ok) throw new Error(sell.message);
    expect(sell.trade).toMatchObject({ price: 79_900, amount: 799_000, commission: 119, tax: 1_598, realizedPnl: 96_283 });
    expect(sell.account.cash).toBe(10_096_178);
    expect(sell.account.positions).toEqual({});
    expect(sell.account.trades).toHaveLength(2);
  });

  it('미래 봉이 있어도 그날 종가로만 체결', () => {
    const acct = createReplayAccount('KR', 10_000_000);
    const r = replayOrder(acct, { code: '005930', side: 'buy', qty: 1, candles: SAMSUNG, time: D1 });
    expect(r.ok && r.trade.price).toBe(70_100);
  });

  it('미국: 센트 단위 수수료', () => {
    const acct = createReplayAccount('US', 10_000);
    const r = replayOrder(acct, { code: 'AAPL', side: 'buy', qty: 3, candles: [candle(D1, 100)], time: D1 });
    if (!r.ok) throw new Error(r.message);
    expect(r.trade).toMatchObject({ price: 100.05, amount: 300.15, commission: 0.75 });
    expect(r.account.cash).toBe(9_699.1);
    expect(r.account.currency).toBe('USD');
  });

  it('돈 부족·보유 수량 초과·봉 없음·잘못된 수량은 거절', () => {
    const acct = createReplayAccount('KR', 100_000);
    expect(replayOrder(acct, { code: '005930', side: 'buy', qty: 2, candles: SAMSUNG, time: D1 })).toMatchObject({ ok: false, message: '돈이 부족해요' });
    expect(replayOrder(acct, { code: '005930', side: 'sell', qty: 1, candles: SAMSUNG, time: D1 })).toMatchObject({ ok: false });
    expect(replayOrder(acct, { code: '005930', side: 'buy', qty: 1, candles: SAMSUNG, time: D1 - DAY })).toMatchObject({ ok: false });
    expect(replayOrder(acct, { code: '005930', side: 'buy', qty: 1.5, candles: SAMSUNG, time: D1 })).toMatchObject({ ok: false });
    expect(replayOrder(acct, { code: '005930', side: 'buy', qty: 0, candles: SAMSUNG, time: D1 })).toMatchObject({ ok: false });
  });

  it('최대 구매 수량은 수수료까지 감안', () => {
    const acct = createReplayAccount('KR', 1_000_000);
    expect(maxReplayBuyQty(acct, 70_000)).toBe(14);
    const r = replayOrder(acct, { code: '005930', side: 'buy', qty: 14, candles: SAMSUNG, time: D1 });
    expect(r.ok).toBe(true);
    expect(maxReplayBuyQty({ ...acct, cash: 0 }, 70_000)).toBe(0);
  });
});

describe('리플레이 평가', () => {
  it('그날 종가로 평가, 시작 금액 대비 수익률', () => {
    const buy = replayOrder(createReplayAccount('KR', 10_000_000), { code: '005930', side: 'buy', qty: 10, candles: SAMSUNG, time: D1 });
    if (!buy.ok) throw new Error(buy.message);
    const histories = { '005930': SAMSUNG };
    expect(valueReplayAccount(buy.account, histories, D1 + DAY)).toEqual({ stockValue: 800_000, total: 10_098_895, returnRate: 98_895 / 10_000_000 });
    const crash = valueReplayAccount(buy.account, histories, D1 + 2 * DAY);
    expect(crash.total).toBe(9_598_895);
    expect(crash.returnRate).toBeCloseTo(-0.0401105);
  });
});

describe('리플레이 진행 저장', () => {
  it('저장 → 되살리기 (같은 시나리오, 같은 날짜)', async () => {
    const { makeReplayProgress, restoreReplayProgress, createReplayAccount } = await import('../src');
    const acc = { ...createReplayAccount('KR', 10_000_000), cash: 9_000_000, positions: { '005930': { code: '005930', qty: 10, avgPrice: 100_000, currency: 'KRW' as const } } };
    const saved = JSON.parse(JSON.stringify(makeReplayProgress('covid-2020-kr', 300, '005930', acc, 1)));
    expect(restoreReplayProgress(saved, 'covid-2020-kr', [100, 200, 300, 400], ['005930', '000660'])).toEqual({ dayIdx: 2, code: '005930', account: acc });
  });

  it('저장된 날이 없으면 그 직전 날로, 종목이 빠졌으면 첫 종목으로', async () => {
    const { makeReplayProgress, restoreReplayProgress, createReplayAccount } = await import('../src');
    const saved = makeReplayProgress('s', 250, 'GONE', createReplayAccount('US', 10_000), 1);
    expect(restoreReplayProgress(saved, 's', [100, 200, 300], ['AAPL'])).toMatchObject({ dayIdx: 1, code: 'AAPL' });
  });

  it('형식이 이상하거나 다른 시나리오면 무시', async () => {
    const { makeReplayProgress, restoreReplayProgress, createReplayAccount } = await import('../src');
    const ok = makeReplayProgress('s', 200, 'A', createReplayAccount('KR', 1), 1);
    expect(restoreReplayProgress(ok, 'other', [200], ['A'])).toBeNull();
    expect(restoreReplayProgress({ ...ok, v: 2 }, 's', [200], ['A'])).toBeNull();
    expect(restoreReplayProgress({ ...ok, account: { cash: 'x' } }, 's', [200], ['A'])).toBeNull();
    expect(restoreReplayProgress(ok, 's', [300], ['A'])).toBeNull();
    expect(restoreReplayProgress('garbage', 's', [200], ['A'])).toBeNull();
  });
});
