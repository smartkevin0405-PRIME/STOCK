import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { MockProvider } from '../src/market/mock';
import { AlertService } from '../src/trading/alerts';
import { openDb } from '../src/trading/db';
import { PushService } from '../src/trading/push';
import { TradingService } from '../src/trading/service';

const NOW = Date.parse('2026-11-03T01:00:00Z');
const provider = new MockProvider({ now: () => NOW });
const db = openDb(':memory:');
const pushed: string[] = [];
const push = new PushService(db, 'test-public-key', async (_s, payload) => {
  pushed.push(JSON.parse(payload).body as string);
});
const alerts = new AlertService(db, () => NOW);
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ provider, trading: new TradingService({ db, provider, now: () => NOW }), alerts, push });
});
afterAll(async () => {
  await app.close();
});

describe('알림 API', () => {
  it('푸시 설정·구독', async () => {
    expect((await app.inject('/api/push')).json()).toEqual({ enabled: true, publicKey: 'test-public-key', devices: 0 });
    const bad = await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: { endpoint: 'http://x' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/push/subscribe', payload: { endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } } });
    expect(ok.json()).toEqual({ devices: 1 });
  });

  it('알림 등록 → 시세가 닿으면 푸시', async () => {
    const [quote] = await provider.getQuotes(['005930']);
    const target = quote!.price + 100;
    const res = await app.inject({ method: 'POST', url: '/api/alerts', payload: { code: '005930', kind: 'above', value: target } });
    expect(res.statusCode).toBe(201);
    expect(res.json().alerts[0]).toMatchObject({ code: '005930', active: true });

    // 시세가 오를 때까지 가짜 시세를 돌림
    for (let i = 0; i < 2_000 && alerts.activeCodes().length; i++) provider.tick();
    await new Promise((r) => setTimeout(r, 10));
    expect(alerts.list()[0]?.active).toBe(false);
    expect(pushed[0]).toContain(`${target.toLocaleString('ko-KR')}원 이상 도달`);
  });

  it('이미 만족한 조건은 400 + 이유', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/alerts', payload: { code: '005930', kind: 'above', value: 1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('이미');
  });
});
