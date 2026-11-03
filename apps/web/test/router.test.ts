import { describe, expect, it } from 'vitest';
import { registerTradingRoutes } from '../../server/src/trading/routes';
import { TradingError } from '../../server/src/trading/service';
import { LocalRouter } from '../src/local/router';

describe('LocalRouter', () => {
  it('경로 변수·쿼리·본문·상태 코드', async () => {
    const r = new LocalRouter();
    r.get('/api/items/:id', async (req: { params: { id: string }; query: { q?: string } }) => ({ id: req.params.id, q: req.query.q }));
    r.post('/api/items', {}, async (req: { body: unknown }, reply: { code(n: number): { send(p: unknown): unknown } }) => reply.code(201).send({ got: req.body }));
    const a = await r.handle('/api/items/a%20b?q=1');
    expect(await a.json()).toEqual({ id: 'a b', q: '1' });
    const b = await r.handle('/api/items', { method: 'POST', body: JSON.stringify({ x: 1 }) });
    expect(b.status).toBe(201);
    expect(await b.json()).toEqual({ got: { x: 1 } });
    expect((await r.handle('/api/nope')).status).toBe(404);
  });

  it('서버 오류 처리기 + onResponse 훅', async () => {
    const r = new LocalRouter();
    const seen: string[] = [];
    // 서버 라우트 등록 코드를 그대로 써서 오류 처리기를 등록
    registerTradingRoutes(r.asFastify(), {} as never, {} as never);
    r.addHook('onResponse', (async (req: { method: string }) => void seen.push(req.method)) as never);
    r.post('/api/fail', async () => {
      throw new TradingError('BAD', '안 돼요', 409);
    });
    const res = await r.handle('/api/fail', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: '안 돼요', code: 'BAD' });
    expect(seen).toEqual(['POST']);
  });
});
