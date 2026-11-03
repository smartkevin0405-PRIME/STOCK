import type { Candle, DataStatus, Quote, StockInfo } from '@stock/shared';
import { describe, expect, it } from 'vitest';
import type { MarketDataProvider } from '../src/market/provider';
import { openDb } from '../src/trading/db';
import { TradingService } from '../src/trading/service';

const SAMSUNG: StockInfo = { code: '005930', market: 'KR', exchange: 'KOSPI', nameKo: '삼성전자', nameEn: '', currency: 'KRW' };
const APPLE: StockInfo = { code: 'AAPL', market: 'US', exchange: 'NASDAQ', nameKo: '애플', nameEn: 'Apple', currency: 'USD' };

const KR_OPEN = Date.parse('2026-11-03T01:00:00Z'); // 화 10:00 KST
const KR_CLOSED = Date.parse('2026-11-03T08:00:00Z'); // 화 17:00 KST
const KR_NEXT_OPEN = Date.parse('2026-11-04T00:00:00Z'); // 수 09:00 KST
const US_OPEN = Date.parse('2026-11-03T15:00:00Z'); // 뉴욕 10:00

/** 테스트용 시세: 가격을 직접 정함 */
class TestProvider implements MarketDataProvider {
  readonly name = 'test';
  prices = new Map<string, number>([['005930', 70_000], ['AAPL', 200]]);
  marketStatus: Quote['marketStatus'];
  watched = new Map<string, string[]>();
  /** 5분봉 (앱이 꺼져 있던 동안 따라잡기용) */
  candles: Candle[] = [];
  candleCalls = 0;
  candleError = false;
  async start() {}
  stop() {}
  status(): DataStatus {
    const s = { source: 'test', delayMinutes: 0, ok: true };
    return { provider: 'test', KR: s, US: s };
  }
  async listStocks() {
    return [SAMSUNG, APPLE];
  }
  async getStock(code: string) {
    return [SAMSUNG, APPLE].find((s) => s.code === code);
  }
  async getQuotes(codes: string[]): Promise<Quote[]> {
    return codes.flatMap((code) => {
      const price = this.prices.get(code);
      const prevClose = code === 'AAPL' ? 200 : 70_000;
      return price === undefined
        ? []
        : [{ code, price, prevClose, volume: 0, change: price - prevClose, changeRate: (price - prevClose) / prevClose, timestamp: 0, ...(this.marketStatus ? { marketStatus: this.marketStatus } : {}) }];
    });
  }
  async getCandles(): Promise<Candle[]> {
    this.candleCalls++;
    if (this.candleError) throw new Error('candles down');
    return this.candles;
  }
  async getIndices() {
    return [];
  }
  async getHistory() {
    return [];
  }
  async getIndexHistory() {
    return [];
  }
  async getRankings() {
    return [];
  }
  async getUsdKrw() {
    return 1_400;
  }
  watch(owner: string, codes: Iterable<string>) {
    this.watched.set(owner, [...codes]);
  }
  onQuote() {
    return () => undefined;
  }
}

function setup(start = KR_OPEN) {
  let now = start;
  const provider = new TestProvider();
  const svc = new TradingService({ db: openDb(':memory:'), provider, now: () => now });
  const events: string[] = [];
  svc.onEvent((e) => events.push(e.event));
  return { svc, provider, events, setNow: (t: number) => (now = t) };
}

describe('주문·체결', () => {
  it('시작 계좌: 시즌 1, 1,000만원', () => {
    const { svc } = setup();
    expect(svc.view()).toMatchObject({ season: 1, cash: { KRW: 10_000_000, USD: 0 }, available: { KRW: 10_000_000 }, positions: [] });
  });

  it('장중 시장가 매수 → 바로 체결 (슬리피지·수수료 반영)', async () => {
    const { svc, events } = setup();
    const { order, fill } = await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 10 });
    expect(order.status).toBe('filled');
    expect(fill).toMatchObject({ price: 70_100, qty: 10, amount: 701_000, commission: 105 });
    const v = svc.view();
    expect(v.cash.KRW).toBe(10_000_000 - 701_105);
    expect(v.positions).toEqual([{ code: '005930', qty: 10, avgPrice: 70_100, currency: 'KRW' }]);
    expect(events).toEqual(['fill']);
  });

  it('지정가 매수 대기 → 돈이 묶임 → 가격이 닿으면 지정가로 체결', async () => {
    const { svc, provider } = setup();
    const { order } = await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 69_000 });
    expect(order.status).toBe('pending');
    expect(svc.view().available.KRW).toBe(10_000_000 - 690_103);
    expect(provider.watched.get('orders')).toEqual(['005930']);

    await svc.processOpenOrders();
    expect(svc.openOrders()).toHaveLength(1);

    provider.prices.set('005930', 68_900);
    await svc.processOpenOrders();
    expect(svc.openOrders()).toHaveLength(0);
    expect(svc.fills()[0]).toMatchObject({ price: 69_000, qty: 10 });
    expect(svc.view().available.KRW).toBe(svc.view().cash.KRW);
    expect(provider.watched.get('orders')).toEqual([]);
  });

  it('매도 → 거래세 + 실현손익', async () => {
    const { svc, provider } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 70_000 });
    provider.prices.set('005930', 80_000);
    const { fill } = await svc.placeOrder({ code: '005930', side: 'sell', type: 'limit', qty: 10, limitPrice: 80_000 });
    expect(fill).toMatchObject({ price: 80_000, commission: 120, tax: 1_600 });
    expect(fill?.realizedPnl).toBe(100_000 - 120 - 1_600);
    expect(svc.view().positions).toEqual([]);
    expect(svc.view().realizedPnl.KRW).toBe(98_280);
  });

  it('미체결 매수 금액까지 합쳐서 잔고 부족 판단', async () => {
    const { svc } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 100, limitPrice: 60_000 });
    await expect(svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 70, limitPrice: 60_000 })).rejects.toThrow('주문가능금액이 부족해요');
  });

  it('미체결 매도 수량까지 합쳐서 판매 가능 수량 판단', async () => {
    const { svc } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 10 });
    await svc.placeOrder({ code: '005930', side: 'sell', type: 'limit', qty: 6, limitPrice: 90_000 });
    expect(svc.view().sellable['005930']).toBe(4);
    await expect(svc.placeOrder({ code: '005930', side: 'sell', type: 'market', qty: 5 })).rejects.toThrow('매도 가능 수량이 부족해요');
  });

  it('취소하면 묶인 돈 풀림', async () => {
    const { svc } = setup();
    const { order } = await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 69_000 });
    expect(svc.cancelOrder(order.id).status).toBe('cancelled');
    expect(svc.view().available.KRW).toBe(10_000_000);
    expect(() => svc.cancelOrder(order.id)).toThrow('이미 체결됐거나 취소된 주문');
  });

  it('정정: 가격을 올려 바로 체결 가능해지면 체결', async () => {
    const { svc } = setup();
    const { order } = await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 69_000 });
    const amended = await svc.amendOrder(order.id, { limitPrice: 70_500 });
    expect(amended.status).toBe('filled');
    expect(svc.fills()[0]?.price).toBe(70_100);
  });

  it('정정: 수량 늘리면 묶이는 돈도 다시 계산', async () => {
    const { svc } = setup();
    const { order } = await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 69_000 });
    await svc.amendOrder(order.id, { qty: 20 });
    expect(svc.view().available.KRW).toBe(10_000_000 - 1_380_207);
  });
});

describe('장 시간', () => {
  it('장 밖 주문 → 예약 → 다음 장 시작에 체결', async () => {
    const { svc, setNow, events } = setup(KR_CLOSED);
    const { order } = await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 1 });
    expect(order.status).toBe('reserved');
    expect(order.expiresAt).toBe(Date.parse('2026-11-04T06:30:00Z'));

    await svc.processOpenOrders();
    expect(svc.openOrders()[0]?.status).toBe('reserved');

    setNow(KR_NEXT_OPEN);
    await svc.processOpenOrders();
    expect(svc.openOrders()).toHaveLength(0);
    expect(events).toEqual(['order', 'fill']);
  });

  it('예약 지정가가 시작가에 안 닿으면 대기 주문으로 전환', async () => {
    const { svc, setNow } = setup(KR_CLOSED);
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 1, limitPrice: 60_000 });
    setNow(KR_NEXT_OPEN);
    await svc.processOpenOrders();
    expect(svc.openOrders()[0]?.status).toBe('pending');
  });

  it('장 마감까지 안 되면 자동 취소 (당일 주문)', async () => {
    const { svc, setNow } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 1, limitPrice: 60_000 });
    setNow(Date.parse('2026-11-03T06:30:00Z'));
    await svc.processOpenOrders();
    expect(svc.openOrders()).toHaveLength(0);
    expect(svc.orders()[0]).toMatchObject({ status: 'cancelled', reason: expect.stringContaining('자동 취소') });
  });

  it('시세 소스가 장이 닫혔다고 하면 체결 안 함 (예상 못 한 휴장)', async () => {
    const { svc, provider } = setup();
    provider.marketStatus = 'closed';
    const { order } = await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 1 });
    expect(order.status).toBe('reserved');
  });

  it('예약 시장가: 장 시작 가격이 너무 올라 잔고가 모자라면 거부', async () => {
    const { svc, provider, setNow } = setup(KR_CLOSED);
    const qty = Math.floor(10_000_000 / (70_100 * 1.00015));
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty });
    provider.prices.set('005930', 75_000);
    setNow(KR_NEXT_OPEN);
    await svc.processOpenOrders();
    expect(svc.orders()[0]).toMatchObject({ status: 'rejected', reason: expect.stringContaining('잔고가 부족') });
    expect(svc.view().cash.KRW).toBe(10_000_000);
  });
});

describe('환전·미국주식', () => {
  it('원→달러 환전 후 미국주식 매수', async () => {
    const { svc, setNow } = setup(US_OPEN);
    await expect(svc.placeOrder({ code: 'AAPL', side: 'buy', type: 'market', qty: 1 })).rejects.toThrow('환전');
    const trade = await svc.exchange('KRW', 1_000_000);
    expect(trade).toMatchObject({ from: 'KRW', to: 'USD', rate: 1_414, pay: 1_000_000, receive: 707.21 });
    expect(svc.view().cash).toEqual({ KRW: 9_000_000, USD: 707.21 });

    setNow(US_OPEN);
    const { fill } = await svc.placeOrder({ code: 'AAPL', side: 'buy', type: 'market', qty: 3 });
    expect(fill).toMatchObject({ price: 200.1, amount: 600.3, commission: 1.5 });
    expect(svc.view().cash.USD).toBe(105.41);
  });

  it('주문가능금액보다 많이 환전 불가', async () => {
    const { svc } = setup();
    await expect(svc.exchange('USD', 10)).rejects.toThrow('부족');
    await expect(svc.exchange('KRW', 0)).rejects.toThrow('금액');
  });
});

describe('계좌 리셋', () => {
  it('시즌 마감 기록 → 새 시즌 1,000만원, 미체결 취소', async () => {
    const { svc, provider } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 70_000 });
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 60_000 });
    provider.prices.set('005930', 80_000);

    const v = await svc.reset();
    expect(v).toMatchObject({ season: 2, cash: { KRW: 10_000_000, USD: 0 }, positions: [], openOrders: 0 });
    const [now, prev] = svc.seasons();
    expect(now).toMatchObject({ season: 2, trades: 0 });
    expect(prev).toMatchObject({ season: 1, trades: 1, finalKrw: 10_000_000 - 700_105 + 800_000 });
    expect(prev?.endedAt).toBeDefined();
  });
});

describe('하루 자산 기록 (오늘 수익)', () => {
  it('하루 경계는 한국시간 오전 7시', async () => {
    const { dayKey } = await import('../src/trading/service');
    expect(dayKey(Date.parse('2026-11-03T21:59:00Z'))).toBe('2026-11-03'); // 11/4 06:59 KST
    expect(dayKey(Date.parse('2026-11-03T22:00:00Z'))).toBe('2026-11-04'); // 11/4 07:00 KST
  });

  it('계좌를 열면 오늘 시작 자산 = 1,000만원', () => {
    const { svc } = setup();
    expect(svc.view().dayBase).toEqual({ day: '2026-11-03', totalKrw: 10_000_000 });
  });

  it('다음 날 오전 7시 이후 첫 확인 때 그 시점 자산을 한 번만 기록', async () => {
    const { svc, provider, setNow } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 70_000 });
    provider.prices.set('005930', 72_000);
    setNow(Date.parse('2026-11-03T22:30:00Z')); // 11/4 07:30 KST
    const snap = await svc.snapshotIfDue();
    expect(snap).toMatchObject({ day: '2026-11-04', totalKrw: 10_000_000 - 700_105 + 720_000, stockKrw: 720_000 });
    provider.prices.set('005930', 80_000);
    expect((await svc.snapshotIfDue())?.totalKrw).toBe(snap?.totalKrw);
    expect(svc.snapshots().map((s) => s.day)).toEqual(['2026-11-03', '2026-11-04']);
    expect(svc.view().dayBase?.totalKrw).toBe(snap?.totalKrw);
  });

  it('리셋하면 새 시즌도 시작 기록', async () => {
    const { svc } = setup();
    await svc.reset();
    expect(svc.snapshots()).toHaveLength(1);
    expect(svc.view().dayBase?.totalKrw).toBe(10_000_000);
  });
});

describe('매매일지', () => {
  it('주문할 때 메모 → 체결되면 일지에 표시', async () => {
    const { svc } = setup();
    const { order } = await svc.placeOrder({
      code: '005930', side: 'buy', type: 'market', qty: 2,
      note: { text: '  실적 발표 기대  ', tags: ['실적', '실적', ' 분할매수 '] },
    });
    const [entry] = svc.journal();
    expect(entry?.order.id).toBe(order.id);
    expect(entry?.fills).toHaveLength(1);
    expect(entry?.note).toMatchObject({ text: '실적 발표 기대', tags: ['실적', '분할매수'] });
  });

  it('미체결 주문은 일지에 안 나옴, 메모 없이도 체결은 나옴', async () => {
    const { svc } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 1, limitPrice: 60_000, note: { text: '대기', tags: [] } });
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 1 });
    const entries = svc.journal();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.note).toBeUndefined();
  });

  it('나중에 메모 쓰기·고치기', async () => {
    const { svc } = setup();
    const { order } = await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 1 });
    svc.saveNote(order.id, { text: '충동구매였다', tags: ['충동'] });
    svc.saveNote(order.id, { text: '충동구매였다. 다음엔 분할로', tags: ['충동', '분할매수'] });
    expect(svc.journal()[0]?.note).toMatchObject({ text: '충동구매였다. 다음엔 분할로', tags: ['충동', '분할매수'] });
    expect(() => svc.saveNote('nope', { text: 'x', tags: [] })).toThrow('주문을 찾을 수 없어요');
  });
});

/** 5분봉 하나 (t: ISO 시각) */
function bar(t: string, o: number, h: number, l: number, c: number): Candle {
  return { time: Date.parse(t) / 1000, open: o, high: h, low: l, close: c, volume: 0 };
}

describe('앱이 꺼져 있던 동안 따라잡기', () => {
  it('지정가 매수: 꺼져 있는 동안 가격이 닿았으면 장 마감이 지나도 그 봉 시각에 지정가로 체결', async () => {
    const { svc, provider, setNow } = setup();
    const { order } = await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 69_000 });
    await svc.processOpenOrders();
    provider.candles = [
      bar('2026-11-03T00:30:00Z', 70_000, 70_000, 60_000, 70_000), // 주문 전 → 무시
      bar('2026-11-03T02:00:00Z', 69_800, 70_000, 69_100, 69_500),
      bar('2026-11-03T03:00:00Z', 69_500, 69_600, 68_800, 69_200),
    ];
    setNow(KR_CLOSED);
    await svc.processOpenOrders();
    expect(svc.orders()[0]).toMatchObject({ id: order.id, status: 'filled', updatedAt: Date.parse('2026-11-03T03:00:00Z') });
    expect(svc.fills()[0]).toMatchObject({ price: 69_000, qty: 10, executedAt: Date.parse('2026-11-03T03:00:00Z') });
    expect(svc.view().cash.KRW).toBe(10_000_000 - 690_103);
  });

  it('닿은 적 없으면 전처럼 만료 취소', async () => {
    const { svc, provider, setNow } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 69_000 });
    provider.candles = [bar('2026-11-03T02:00:00Z', 69_800, 70_000, 69_100, 69_500)];
    setNow(KR_CLOSED);
    await svc.processOpenOrders();
    expect(svc.orders()[0]).toMatchObject({ status: 'cancelled', reason: expect.stringContaining('자동 취소') });
    expect(svc.fills()).toHaveLength(0);
  });

  it('봉을 못 받으면 건너뛰고 전처럼 만료 취소', async () => {
    const { svc, provider, setNow } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 69_000 });
    provider.candleError = true;
    setNow(KR_CLOSED);
    await svc.processOpenOrders();
    expect(svc.orders()[0]?.status).toBe('cancelled');
  });

  it('지정가 매도: 고가가 닿은 봉에서 지정가로 체결', async () => {
    const { svc, provider, setNow, events } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 10 });
    await svc.placeOrder({ code: '005930', side: 'sell', type: 'limit', qty: 10, limitPrice: 72_000 });
    provider.candles = [
      bar('2026-11-03T01:30:00Z', 70_500, 71_900, 70_400, 71_800),
      bar('2026-11-03T02:00:00Z', 71_800, 72_500, 71_700, 71_000),
    ];
    provider.prices.set('005930', 71_000);
    setNow(Date.parse('2026-11-03T03:00:00Z'));
    await svc.processOpenOrders();
    expect(svc.fills()[0]).toMatchObject({ side: 'sell', price: 72_000, executedAt: Date.parse('2026-11-03T02:00:00Z') });
    expect(svc.view().positions).toEqual([]);
    expect(events.at(-1)).toBe('fill');
  });

  it('예약 시장가: 장 시작 봉의 시가로 체결', async () => {
    const { svc, provider, setNow } = setup(KR_CLOSED);
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 1 });
    await svc.processOpenOrders();
    provider.candles = [
      bar('2026-11-03T06:25:00Z', 70_400, 70_600, 70_300, 70_500), // 전날 마지막 봉
      bar('2026-11-03T07:00:00Z', 70_500, 70_500, 70_500, 70_500), // 장 밖 → 무시
      bar('2026-11-04T00:00:00Z', 71_000, 71_500, 70_800, 71_400),
      bar('2026-11-04T00:05:00Z', 72_000, 72_500, 71_900, 72_400),
    ];
    provider.prices.set('005930', 73_000);
    setNow(Date.parse('2026-11-04T02:00:00Z'));
    await svc.processOpenOrders();
    const fill = svc.fills()[0];
    expect(fill).toMatchObject({ price: 71_000, executedAt: KR_NEXT_OPEN });
    expect(fill?.dayChangeRate).toBeCloseTo(500 / 70_500);
  });

  it('예약 지정가 매수: 시가가 지정가보다 낮게 시작하면 시가로 체결', async () => {
    const { svc, provider, setNow } = setup(KR_CLOSED);
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 1, limitPrice: 70_000 });
    provider.candles = [bar('2026-11-04T00:00:00Z', 68_000, 68_500, 67_500, 68_200)];
    setNow(Date.parse('2026-11-04T08:00:00Z'));
    await svc.processOpenOrders();
    expect(svc.fills()[0]).toMatchObject({ price: 68_000, executedAt: KR_NEXT_OPEN });
    expect(svc.orders()[0]?.status).toBe('filled');
  });

  it('감시 공백이 1분 이하면 따라잡지 않음', async () => {
    const { svc, provider, setNow } = setup();
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 69_000 });
    await svc.processOpenOrders();
    const calls = provider.candleCalls;
    provider.candles = [bar('2026-11-03T01:00:00Z', 69_500, 69_500, 68_000, 69_400)];
    setNow(KR_OPEN + 30_000);
    await svc.processOpenOrders();
    expect(provider.candleCalls).toBe(calls);
    expect(svc.openOrders()).toHaveLength(1);

    setNow(KR_OPEN + 30_000 + 61_000);
    await svc.processOpenOrders();
    expect(provider.candleCalls).toBe(calls + 1);
    expect(svc.fills()[0]).toMatchObject({ price: 69_000 });
  });
});
