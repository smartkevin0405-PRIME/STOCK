import type { Candle, Quote, StockInfo } from '@stock/shared';
import { describe, expect, it } from 'vitest';
import { StockDirectory } from '../src/market/directory';
import { LiveProvider } from '../src/market/live';
import { FallbackSource, UnsupportedError, type MarketExtrasSource, type QuoteSource } from '../src/market/sources';

const SAMSUNG: StockInfo = { code: '005930', market: 'KR', exchange: 'KOSPI', nameKo: '삼성전자', nameEn: 'Samsung', currency: 'KRW' };
const HYNIX: StockInfo = { code: '000660', market: 'KR', exchange: 'KOSPI', nameKo: 'SK하이닉스', nameEn: 'SK hynix', currency: 'KRW' };
const APPLE: StockInfo = { code: 'AAPL', market: 'US', exchange: 'NASDAQ', nameKo: '애플', nameEn: 'Apple', currency: 'USD' };

/** 테스트용 소스: 가격을 직접 정하고, 실패하게 만들 수 있음 */
class FakeSource implements QuoteSource {
  prices = new Map<string, number>();
  failing = false;
  calls: string[][] = [];
  constructor(readonly name: string, readonly delayMinutes = 0) {}
  async fetchQuotes(stocks: StockInfo[]): Promise<Quote[]> {
    this.calls.push(stocks.map((s) => s.code));
    if (this.failing) throw new Error(`${this.name} down`);
    return stocks.flatMap((s) => {
      const price = this.prices.get(s.code);
      return price === undefined ? [] : [{ code: s.code, price, prevClose: price, open: price, high: price, low: price, volume: 1, change: 0, changeRate: 0, timestamp: 0 }];
    });
  }
  async fetchCandles(): Promise<Candle[]> {
    if (this.failing) throw new Error(`${this.name} down`);
    return [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  }
}

const extras: MarketExtrasSource = {
  name: 'fake',
  fetchIndices: async () => [{ symbol: '^KS11', name: '코스피', price: 2600, change: 0, changeRate: 0 }],
  fetchUsdKrw: async () => 1400,
};

describe('소스 자동 전환', () => {
  it('첫 소스가 되면 첫 소스 사용', async () => {
    const naver = new FakeSource('naver');
    const yahoo = new FakeSource('yahoo', 20);
    naver.prices.set('005930', 70_000);
    const src = new FallbackSource([naver, yahoo]);
    const [q] = await src.fetchQuotes([SAMSUNG]);
    expect(q).toMatchObject({ price: 70_000, delayMinutes: 0 });
    expect(src.status()).toEqual({ source: 'naver', delayMinutes: 0, ok: true });
  });

  it('첫 소스가 실패하면 다음 소스로, 지연 시간도 표시', async () => {
    const naver = new FakeSource('naver');
    const yahoo = new FakeSource('yahoo', 20);
    naver.failing = true;
    yahoo.prices.set('005930', 69_900);
    const src = new FallbackSource([naver, yahoo]);
    const [q] = await src.fetchQuotes([SAMSUNG]);
    expect(q).toMatchObject({ price: 69_900, delayMinutes: 20 });
    expect(src.status()).toEqual({ source: 'yahoo', delayMinutes: 20, ok: true });
  });

  it('연속 실패하면 잠시 건너뛰고, 쉬는 시간이 지나면 다시 시도', async () => {
    let now = 0;
    const naver = new FakeSource('naver');
    const yahoo = new FakeSource('yahoo', 20);
    naver.failing = true;
    yahoo.prices.set('005930', 69_900);
    const src = new FallbackSource([naver, yahoo], { failureThreshold: 2, cooldownMs: 60_000, now: () => now });

    for (let i = 0; i < 3; i++) await src.fetchQuotes([SAMSUNG]);
    expect(naver.calls).toHaveLength(2); // 2번 실패 후 건너뜀

    naver.failing = false;
    naver.prices.set('005930', 70_000);
    now = 60_000;
    const [q] = await src.fetchQuotes([SAMSUNG]);
    expect(q?.price).toBe(70_000);
    expect(src.status().source).toBe('naver');
  });

  it('첫 소스가 못 준 종목만 다음 소스에 요청', async () => {
    const naver = new FakeSource('naver');
    const yahoo = new FakeSource('yahoo', 20);
    naver.prices.set('005930', 70_000);
    yahoo.prices.set('005930', 1).set('000660', 199_000);
    const src = new FallbackSource([naver, yahoo]);
    const quotes = await src.fetchQuotes([SAMSUNG, HYNIX]);
    expect(quotes.map((q) => [q.code, q.price, q.delayMinutes])).toEqual([['005930', 70_000, 0], ['000660', 199_000, 20]]);
    expect(yahoo.calls).toEqual([['000660']]);
    expect(src.status().source).toBe('naver');
  });

  it('제공하지 않는 데이터는 실패로 치지 않음', async () => {
    const naver = new FakeSource('naver');
    naver.fetchCandles = async () => {
      throw new UnsupportedError('no minute');
    };
    const yahoo = new FakeSource('yahoo');
    const src = new FallbackSource([naver, yahoo], { failureThreshold: 1 });
    await src.fetchCandles(APPLE, '1m', 10);
    naver.prices.set('AAPL', 200);
    const [q] = await src.fetchQuotes([APPLE]);
    expect(q?.price).toBe(200); // 네이버가 시세에서는 여전히 1순위
  });

  it('전부 실패하면 에러 + 상태 표시', async () => {
    const a = new FakeSource('a');
    a.failing = true;
    const src = new FallbackSource([a]);
    await expect(src.fetchQuotes([SAMSUNG])).rejects.toThrow('모든 시세 소스 실패');
    expect(src.status().ok).toBe(false);
  });
});

function setup(start = Date.parse('2026-11-03T01:00:00Z')) {
  // 기본: 한국 장중(10시), 미국 장 마감
  let now = start;
  const kr = new FakeSource('naver');
  const us = new FakeSource('yahoo');
  kr.prices.set('005930', 70_000).set('000660', 200_000);
  us.prices.set('AAPL', 200);
  const provider = new LiveProvider({
    directory: new StockDirectory([SAMSUNG, HYNIX, APPLE]),
    sources: { KR: new FallbackSource([kr]), US: new FallbackSource([us]) },
    extras,
    quoteTtlMs: 2_500,
    closedIntervalMs: 60_000,
    rankings: async (type, market) =>
      market === 'KR'
        ? [{ stock: { ...SAMSUNG }, quote: { code: '005930', price: 71_000, prevClose: 70_000, volume: 10, change: 1_000, changeRate: 1 / 70, timestamp: 0 } },
           { stock: { code: '999999', market: 'KR', exchange: 'KOSDAQ', nameKo: '신규상장', nameEn: '', currency: 'KRW' }, quote: { code: '999999', price: 1_000, prevClose: 800, volume: 1, change: 200, changeRate: 0.25, timestamp: 0 } }]
        : [{ stock: APPLE, quote: { code: 'AAPL', price: 300, prevClose: 200, volume: 1, change: 100, changeRate: 0.5, timestamp: 0 } }],
    now: () => now,
  });
  return { provider, kr, us, advance: (ms: number) => (now += ms) };
}

describe('실제 시세 공급자', () => {
  it('시장별로 나눠서 요청', async () => {
    const { provider, kr, us } = setup();
    const quotes = await provider.getQuotes(['005930', 'AAPL', '000660']);
    expect(quotes.map((q) => q.code)).toEqual(['005930', 'AAPL', '000660']);
    expect(kr.calls).toEqual([['005930', '000660']]);
    expect(us.calls).toEqual([['AAPL']]);
  });

  it('짧은 시간 안에는 캐시 사용', async () => {
    const { provider, kr, advance } = setup();
    await provider.getQuotes(['005930']);
    advance(1_000);
    await provider.getQuotes(['005930']);
    expect(kr.calls).toHaveLength(1);
    advance(2_000);
    await provider.getQuotes(['005930']);
    expect(kr.calls).toHaveLength(2);
  });

  it('요청 실패하면 마지막 시세 유지', async () => {
    const { provider, kr, advance } = setup();
    await provider.getQuotes(['005930']);
    kr.failing = true;
    advance(5_000);
    const [q] = await provider.getQuotes(['005930']);
    expect(q?.price).toBe(70_000);
  });

  it('화면에 보이는 종목만 주기 조회, 가격이 바뀐 것만 알림', async () => {
    const { provider, kr } = setup();
    const got: string[] = [];
    provider.onQuote((q) => got.push(`${q.code}:${q.price}`));
    provider.watch('screens', ['005930']);

    await provider.pollWatched();
    await provider.pollWatched(); // 가격 그대로 → 알림 없음
    kr.prices.set('005930', 70_100);
    await provider.pollWatched();

    expect(got).toEqual(['005930:70000', '005930:70100']);
    expect(kr.calls.every((c) => c.length === 1 && c[0] === '005930')).toBe(true);
  });

  it('장이 닫힌 시장 종목은 1분에 한 번만', async () => {
    const { provider, kr, us, advance } = setup();
    provider.watch('screens', ['005930', 'AAPL']);
    await provider.pollWatched();
    advance(3_000);
    await provider.pollWatched();
    expect(kr.calls).toHaveLength(2); // 한국 장중 → 매번
    expect(us.calls).toHaveLength(1); // 미국 마감 → 건너뜀
    advance(60_000);
    await provider.pollWatched();
    expect(us.calls).toHaveLength(2);
  });

  it('순위: 국내+미국 합쳐서 정렬, 처음 보는 종목은 목록에 추가', async () => {
    const { provider } = setup();
    const items = await provider.getRankings('gainers');
    expect(items.map((x) => x.stock.code)).toEqual(['AAPL', '999999', '005930']);
    expect(await provider.getStock('999999')).toMatchObject({ nameKo: '신규상장' });
    const [q] = await provider.getQuotes(['999999']);
    expect(q?.price).toBe(1_000); // 순위에서 받은 시세 재사용
  });

  it('여러 곳에서 등록한 종목을 합쳐서 조회', async () => {
    const { provider, kr } = setup();
    provider.watch('screens', ['005930']);
    provider.watch('orders', ['000660']);
    await provider.pollWatched();
    expect(kr.calls).toEqual([['005930', '000660']]);
    provider.watch('screens', []);
    await provider.pollWatched();
    expect(kr.calls[1]).toEqual(['000660']);
  });

  it('보이는 종목이 없으면 요청 안 함', async () => {
    const { provider, kr } = setup();
    await provider.pollWatched();
    expect(kr.calls).toHaveLength(0);
  });

  it('지수·환율', async () => {
    const { provider } = setup();
    expect(await provider.getUsdKrw()).toBe(1400);
    expect((await provider.getIndices())[0]?.symbol).toBe('^KS11');
  });

  it('상태: 시장별 소스', () => {
    const { provider } = setup();
    expect(provider.status()).toMatchObject({ provider: 'live', KR: { source: 'naver' }, US: { source: 'yahoo' } });
  });
});

describe('종목 목록', () => {
  it('갱신해도 별칭 유지', () => {
    const dir = new StockDirectory([{ ...APPLE, aliases: ['애플'] }]);
    dir.replace([{ ...APPLE, nameEn: 'Apple Inc.' }]);
    expect(dir.get('AAPL')).toMatchObject({ nameEn: 'Apple Inc.', aliases: ['애플'] });
    expect(dir.get('aapl')?.code).toBe('AAPL');
  });
});
