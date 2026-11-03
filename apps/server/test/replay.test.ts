import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { MockProvider } from '../src/market/mock';
import { REPLAY_SCENARIOS } from '../src/replay/scenarios';
import { ReplayStore } from '../src/replay/store';
import { openDb } from '../src/trading/db';

const NOW = Date.parse('2026-11-03T01:00:00Z');
const provider = new MockProvider({ now: () => NOW });
const db = openDb(':memory:');
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ provider, replay: new ReplayStore(db, () => NOW) });
});
afterAll(async () => {
  await app.close();
});

const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/replay/results', payload });
const valid = { scenarioId: 'covid-2020-kr', codes: ['005930', '000660'], finalValue: 11_000_000, returnRate: 0.1, tradeCount: 4 };

describe('리플레이 시나리오', () => {
  it('목록 + 종목 정보', async () => {
    const res = await app.inject('/api/replay/scenarios');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scenarios.map((s: { id: string }) => s.id)).toContain('covid-2020-kr');
    expect(body.stocks['005930'].nameKo).toBe('삼성전자');
    expect(body.stocks.AAPL.currency).toBe('USD');
  });

  it('시나리오 종목은 통화가 시장과 맞고, 기간이 올바름', async () => {
    for (const s of REPLAY_SCENARIOS) {
      expect(s.currency).toBe(s.market === 'KR' ? 'KRW' : 'USD');
      expect(Date.parse(s.start)).toBeLessThan(Date.parse(s.end));
      for (const code of s.codes) expect((await provider.getStock(code))?.market).toBe(s.market);
    }
  });
});

describe('리플레이 과거 일봉', () => {
  it('기간 일봉', async () => {
    const from = Date.UTC(2020, 1, 3);
    const to = Date.UTC(2020, 5, 30);
    const res = await app.inject(`/api/replay/history?code=005930&from=${from}&to=${to}`);
    expect(res.statusCode).toBe(200);
    const { stock, candles } = res.json();
    expect(stock.code).toBe('005930');
    expect(candles.length).toBeGreaterThan(80);
    expect(candles[0].time * 1000).toBeGreaterThanOrEqual(from);
    expect(candles.at(-1).time * 1000).toBeLessThanOrEqual(to);
  });

  it('잘못된 요청은 400·404', async () => {
    const from = Date.UTC(2020, 1, 3);
    const to = Date.UTC(2020, 5, 30);
    expect((await app.inject(`/api/replay/history?from=${from}&to=${to}`)).statusCode).toBe(400);
    expect((await app.inject(`/api/replay/history?code=005930&from=${to}&to=${from}`)).statusCode).toBe(400);
    expect((await app.inject(`/api/replay/history?code=005930&from=abc&to=${to}`)).statusCode).toBe(400);
    expect((await app.inject(`/api/replay/history?code=005930&from=${Date.UTC(2010, 0, 1)}&to=${to}`)).statusCode).toBe(400);
    expect((await app.inject(`/api/replay/history?code=005930&from=${from}&to=${NOW + 10 * 86_400_000}`)).statusCode).toBe(400);
    expect((await app.inject(`/api/replay/history?code=NOPE&from=${from}&to=${to}`)).statusCode).toBe(404);
  });
});

describe('리플레이 결과', () => {
  it('저장 → 목록 (최근 순)', async () => {
    const a = await post({ ...valid, finishedAt: NOW - 1_000 });
    expect(a.statusCode).toBe(201);
    expect(a.json().result).toMatchObject({ id: 1, scenarioId: 'covid-2020-kr', startCash: 10_000_000, finalValue: 11_000_000, tradeCount: 4 });
    const b = await post({ scenarioId: 'covid-2020-us', codes: ['AAPL'], finalValue: 9_000, returnRate: -0.1, tradeCount: 0 });
    expect(b.json().result.finishedAt).toBe(NOW);

    const all = (await app.inject('/api/replay/results')).json().results;
    expect(all.map((r: { scenarioId: string }) => r.scenarioId)).toEqual(['covid-2020-us', 'covid-2020-kr']);
    const one = (await app.inject('/api/replay/results?scenarioId=covid-2020-kr')).json().results;
    expect(one).toHaveLength(1);
    expect(one[0].codes).toEqual(['005930', '000660']);
  });

  it('잘못된 결과는 400', async () => {
    const cases: Record<string, unknown>[] = [
      { ...valid, scenarioId: 'nope' },
      { ...valid, codes: [] },
      { ...valid, codes: ['AAPL'] },
      { ...valid, codes: ['005930', '005930'] },
      { ...valid, finalValue: -1 },
      { ...valid, finalValue: 'a lot' },
      { ...valid, returnRate: 0.5 },
      { ...valid, tradeCount: 1.5 },
      { ...valid, tradeCount: -1 },
      { ...valid, finishedAt: NOW + 10 * 86_400_000 },
    ];
    for (const c of cases) expect((await post(c)).statusCode, JSON.stringify(c)).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/replay/results' })).statusCode).toBe(400);
  });
});
