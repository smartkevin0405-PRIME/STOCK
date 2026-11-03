import type { Currency, JournalNote, OrderSide, OrderType, StockInfo } from '@stock/shared';
import type { MarketDataProvider } from '../market/provider';
import type { FastifyInstance } from 'fastify';
import { TradingError, type TradingService } from './service';

const isSide = (v: unknown): v is OrderSide => v === 'buy' || v === 'sell';
const isType = (v: unknown): v is OrderType => v === 'market' || v === 'limit';
const isCcy = (v: unknown): v is Currency => v === 'KRW' || v === 'USD';

/** 요청 본문의 메모 → JournalNote (형식이 이상하면 undefined) */
function parseNote(v: unknown): JournalNote | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { text, tags } = v as { text?: unknown; tags?: unknown };
  return {
    text: typeof text === 'string' ? text : '',
    tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [],
  };
}

/** 계좌·주문·환전 API */
export function registerTradingRoutes(app: FastifyInstance, trading: TradingService, provider: MarketDataProvider): void {
  /** 화면에 종목명을 보여주기 위해 코드 → 종목 정보 */
  const stocksOf = async (codes: string[]): Promise<Record<string, StockInfo>> => {
    const list = await Promise.all([...new Set(codes)].map((c) => provider.getStock(c)));
    return Object.fromEntries(list.flatMap((s) => (s ? [[s.code, s]] : [])));
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof TradingError) return reply.code(err.status).send({ error: err.message, code: err.code });
    app.log.error(err);
    return reply.code((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message });
  });

  app.get('/api/account', async () => {
    const view = trading.view();
    return { ...view, stocks: await stocksOf(view.positions.map((p) => p.code)) };
  });

  app.post('/api/account/reset', async () => trading.reset());

  app.get('/api/seasons', async () => ({ seasons: trading.seasons() }));

  app.get<{ Querystring: { limit?: string } }>('/api/snapshots', async (req) => ({
    snapshots: trading.snapshots(Math.min(Number(req.query.limit) || 400, 2_000)),
  }));

  app.get<{ Querystring: { status?: string; limit?: string } }>('/api/orders', async (req) => {
    const orders = req.query.status === 'open' ? trading.openOrders() : trading.orders(Math.min(Number(req.query.limit) || 100, 500));
    return { orders, stocks: await stocksOf(orders.map((o) => o.code)) };
  });

  app.post<{ Body: { code?: unknown; side?: unknown; type?: unknown; qty?: unknown; limitPrice?: unknown; note?: unknown } }>('/api/orders', async (req, reply) => {
    const b = req.body ?? {};
    if (typeof b.code !== 'string' || !isSide(b.side) || !isType(b.type) || typeof b.qty !== 'number') {
      throw new TradingError('BAD_REQUEST', '주문 내용이 올바르지 않아요');
    }
    if (b.type === 'limit' && typeof b.limitPrice !== 'number') throw new TradingError('BAD_REQUEST', '주문 가격을 입력해주세요');
    const result = await trading.placeOrder({
      code: b.code,
      side: b.side,
      type: b.type,
      qty: b.qty,
      ...(typeof b.limitPrice === 'number' ? { limitPrice: b.limitPrice } : {}),
      ...(parseNote(b.note) ? { note: parseNote(b.note)! } : {}),
    });
    return reply.code(201).send(result);
  });

  app.post<{ Params: { id: string } }>('/api/orders/:id/cancel', async (req) => ({ order: trading.cancelOrder(req.params.id) }));

  app.patch<{ Params: { id: string }; Body: { qty?: unknown; limitPrice?: unknown } }>('/api/orders/:id', async (req) => {
    const b = req.body ?? {};
    return {
      order: await trading.amendOrder(req.params.id, {
        ...(typeof b.qty === 'number' ? { qty: b.qty } : {}),
        ...(typeof b.limitPrice === 'number' ? { limitPrice: b.limitPrice } : {}),
      }),
    };
  });

  app.get<{ Querystring: { code?: string; limit?: string } }>('/api/fills', async (req) => {
    const fills = trading.fills(Math.min(Number(req.query.limit) || 100, 500), req.query.code);
    return { fills, stocks: await stocksOf(fills.map((f) => f.code)) };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/journal', async (req) => {
    const entries = trading.journal(Math.min(Number(req.query.limit) || 100, 500));
    return { entries, stocks: await stocksOf(entries.map((e) => e.order.code)) };
  });

  app.put<{ Params: { orderId: string }; Body: unknown }>('/api/journal/:orderId', async (req) => {
    const note = parseNote(req.body);
    if (!note) throw new TradingError('BAD_REQUEST', '메모 내용이 올바르지 않아요');
    return { note: trading.saveNote(req.params.orderId, note) };
  });

  app.get('/api/fx/trades', async () => ({ trades: trading.fxTrades() }));

  app.post<{ Body: { from?: unknown; amount?: unknown } }>('/api/fx', async (req, reply) => {
    const { from, amount } = req.body ?? {};
    if (!isCcy(from) || typeof amount !== 'number') throw new TradingError('BAD_REQUEST', '환전 내용이 올바르지 않아요');
    return reply.code(201).send({ trade: await trading.exchange(from, amount) });
  });
}
