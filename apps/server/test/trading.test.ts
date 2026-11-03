import type { DataStatus, Quote, StockInfo } from '@stock/shared';
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
  async getCandles() {
    return [];
  }
  async getIndices() {
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
