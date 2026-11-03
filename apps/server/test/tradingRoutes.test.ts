import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { MockProvider } from '../src/market/mock';
import { openDb } from '../src/trading/db';
import { TradingService } from '../src/trading/service';

const NOW = Date.parse('2026-11-03T01:00:00Z'); // 한국 장중
const provider = new MockProvider({ now: () => NOW });
const trading = new TradingService({ db: openDb(':memory:'), provider, now: () => NOW });
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp({ provider, trading });
});
afterAll(async () => {
  await app.close();
});

describe('계좌 API', () => {
  it('내 계좌', async () => {
    const res = await app.inject('/api/account');
    expect(res.json()).toMatchObject({ season: 1, cash: { KRW: 10_000_000 } });
  });

  it('잘못된 주문 → 400 + 이유', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/orders', payload: { code: '005930', side: 'buy', type: 'market', qty: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: '수량은 1주 이상 정수로 입력해주세요', code: 'INVALID_QTY' });
    expect((await app.inject({ method: 'POST', url: '/api/orders', payload: { code: 1 } })).statusCode).toBe(400);
  });

  it('시장가 매수 → 201 + 체결', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/orders', payload: { code: '005930', side: 'buy', type: 'market', qty: 1 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().order.status).toBe('filled');
    expect((await app.inject('/api/fills')).json().fills).toHaveLength(1);
  });

  it('지정가 → 미체결 목록 → 취소', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/orders', payload: { code: '005930', side: 'buy', type: 'limit', qty: 1, limitPrice: 60_000 } });
    const { id } = res.json().order;
    expect((await app.inject('/api/orders?status=open')).json().orders.map((o: { id: string }) => o.id)).toContain(id);
    const cancel = await app.inject({ method: 'POST', url: `/api/orders/${id}/cancel` });
    expect(cancel.json().order.status).toBe('cancelled');
    expect((await app.inject({ method: 'POST', url: '/api/orders/nope/cancel' })).statusCode).toBe(404);
  });

  it('환전', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/fx', payload: { from: 'KRW', amount: 100_000 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().trade.to).toBe('USD');
  });

  it('리셋 → 시즌 2', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/account/reset' });
    expect(res.json().season).toBe(2);
    expect((await app.inject('/api/seasons')).json().seasons).toHaveLength(2);
  });
});
