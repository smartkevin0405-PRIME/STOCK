import { describe, expect, it } from 'vitest';
import { CorporateActions, adjustForSplits, type CorporateEvents } from '../src/trading/corporate';
import { openDb } from '../src/trading/db';
import { TradingService } from '../src/trading/service';
import { StatsService } from '../src/trading/stats';
import { KR_OPEN, TestProvider } from './helpers';

const DAY = 86_400_000;

function setup(events: CorporateEvents) {
  let now = KR_OPEN;
  const provider = new TestProvider();
  const trading = new TradingService({ db: openDb(':memory:'), provider, now: () => now });
  const corp = new CorporateActions(trading, provider, async () => events, () => now);
  return { trading, provider, corp, setNow: (t: number) => (now = t) };
}

describe('배당', () => {
  it('배당락 전 보유 수량 × 배당금 - 세금 15.4% → 현금, 두 번 반영 안 함', async () => {
    const ev: CorporateEvents = { dividends: [{ date: KR_OPEN + 2 * DAY, amount: 361 }], splits: [] };
    const { trading, corp, setNow } = setup(ev);
    await trading.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 70_000 });
    const before = trading.view().cash.KRW;
    setNow(KR_OPEN + 3 * DAY);
    const applied = await corp.run();
    expect(applied).toEqual([{ code: '005930', kind: 'dividend', date: KR_OPEN + 2 * DAY, value: Math.floor(3_610 * 0.846), qty: 10 }]);
    expect(trading.view().cash.KRW).toBe(before + Math.floor(3_610 * 0.846));
    expect(await corp.run()).toEqual([]);
  });

  it('배당락 뒤에 산 주식은 대상 아님', async () => {
    const { trading, corp, setNow } = setup({ dividends: [{ date: KR_OPEN - DAY / 2, amount: 361 }], splits: [] });
    await trading.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 70_000 });
    setNow(KR_OPEN + DAY);
    expect(await corp.run()).toEqual([]);
  });
});

describe('액면분할', () => {
  it('수량 × 비율, 평균단가 ÷ 비율, 미체결 취소, 통계도 분할 기준으로', async () => {
    const { trading, provider, corp, setNow } = setup({ dividends: [], splits: [{ date: KR_OPEN + DAY, ratio: 5 }] });
    await trading.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 70_000 });
    await trading.placeOrder({ code: '005930', side: 'sell', type: 'limit', qty: 1, limitPrice: 90_000 });
    setNow(KR_OPEN + DAY + 3_600_000);
    const [a] = await corp.run();
    expect(a).toMatchObject({ kind: 'split', value: 5, qty: 50 });
    expect(trading.view().positions[0]).toMatchObject({ qty: 50, avgPrice: 14_000 });
    expect(trading.openOrders()).toEqual([]);

    // 분할 뒤 50주를 다 팔아도 통계가 깨지지 않음
    provider.prices.set('005930', 15_000);
    provider.prevCloses.set('005930', 14_000);
    await trading.placeOrder({ code: '005930', side: 'sell', type: 'limit', qty: 50, limitPrice: 15_000 });
    const stats = await new StatsService(trading, provider, () => KR_OPEN + DAY + 3_600_000).stats('all');
    expect(stats.trades.count).toBe(1);
    expect(stats.trades.wins).toBe(1);
  });

  it('1주 미만 자투리는 현금 정산', async () => {
    const { trading, corp, setNow } = setup({ dividends: [], splits: [{ date: KR_OPEN + DAY, ratio: 0.5 }] });
    await trading.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 3, limitPrice: 70_000 });
    const cash = trading.view().cash.KRW;
    setNow(KR_OPEN + 2 * DAY);
    await corp.run();
    expect(trading.view().positions[0]).toMatchObject({ qty: 1, avgPrice: 140_000 });
    expect(trading.view().cash.KRW).toBe(cash + 70_000); // 0.5주 × 140,000원
  });

  it('분할 환산 함수', () => {
    const f = { orderId: 'o', code: 'A', side: 'buy' as const, price: 100, qty: 2, amount: 200, commission: 0, tax: 0, currency: 'USD' as const, executedAt: 1 };
    expect(adjustForSplits([f], [{ code: 'A', date: 5, value: 4 }])[0]).toMatchObject({ qty: 8, price: 25 });
    expect(adjustForSplits([f], [{ code: 'A', date: 0, value: 4 }])[0]).toMatchObject({ qty: 2, price: 100 });
  });
});
