import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { MockProvider } from '../src/market/mock';

const provider = new MockProvider({ now: () => Date.parse('2026-11-03T03:00:00Z') });
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ provider });
});
afterAll(async () => {
  await app.close();
});

describe('API', () => {
  it('헬스체크', async () => {
    const res = await app.inject('/api/health');
    expect(res.json()).toMatchObject({ ok: true, provider: 'mock', KR: { source: 'mock', delayMinutes: 0 } });
  });

  it('초성 검색 + 시세 같이 반환', async () => {
    const res = await app.inject('/api/stocks?q=' + encodeURIComponent('ㅅㅅㅈㅈ'));
    const { items } = res.json();
    expect(items[0].stock.code).toBe('005930');
    expect(items[0].quote.price).toBeGreaterThan(0);
  });

  it('없는 종목은 404', async () => {
    expect((await app.inject('/api/stocks/XXXX')).statusCode).toBe(404);
  });

  it('일봉·주봉·분봉', async () => {
    const d = (await app.inject('/api/candles/005930?interval=1d&limit=100')).json().candles;
    expect(d).toHaveLength(100);
    expect(d[d.length - 1].time).toBeGreaterThan(d[0].time);
    const w = (await app.inject('/api/candles/005930?interval=1w')).json().candles;
    expect(w.length).toBeGreaterThan(70);
    const m5 = (await app.inject('/api/candles/AAPL?interval=5m')).json().candles;
    expect(m5.length).toBeGreaterThanOrEqual(78);
    expect((await app.inject('/api/candles/005930?interval=2h')).statusCode).toBe(400);
  });

  it('지수·환율', async () => {
    const { indices, usdKrw } = (await app.inject('/api/indices')).json();
    expect(indices.map((i: { symbol: string }) => i.symbol)).toContain('^KS11');
    expect(usdKrw).toBeGreaterThan(1_000);
  });

  it('장 상태', async () => {
    const res = (await app.inject('/api/market-status')).json();
    expect(res.KR.state).toMatch(/open|closed/);
    expect(res.US.nextOpen).toBeGreaterThan(0);
  });

  it('상승률 순위는 내림차순', async () => {
    const { items } = (await app.inject('/api/rankings?type=gainers')).json();
    const rates = items.map((x: { quote: { changeRate: number } }) => x.quote.changeRate);
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
  });
});

describe('가짜 시세', () => {
  it('시세가 호가단위·가격제한폭을 지킴', async () => {
    for (let i = 0; i < 200; i++) provider.tick();
    const quotes = await provider.getQuotes(['005930', 'SOUN', 'AAPL']);
    const [samsung, soun, apple] = quotes;
    expect(samsung!.price % 100).toBe(0); // 5만~20만원대는 100원 단위
    expect(Math.abs(samsung!.changeRate)).toBeLessThanOrEqual(0.3);
    expect(Number(soun!.price.toFixed(4))).toBe(soun!.price);
    expect(Number(apple!.price.toFixed(2))).toBe(apple!.price);
  });

  it('구독자에게 시세 전달', () => {
    const got: string[] = [];
    const off = provider.onQuote((q) => got.push(q.code));
    for (let i = 0; i < 5; i++) provider.tick();
    off();
    expect(got.length).toBeGreaterThan(0);
  });
});
