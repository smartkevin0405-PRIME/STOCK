import type { OrderBook, StockInfo } from '@stock/shared';
import type { FastifyInstance } from 'fastify';
import type { MarketDataProvider } from './provider';

/** 종목 → 10단계 호가. 못 주는 종목이면 null */
export type OrderBookFetcher = (stock: StockInfo) => Promise<OrderBook | null>;

/** GET /api/orderbook/:code — 호가를 주는 소스(한투)가 있을 때만 데이터, 없으면 404 */
export function registerOrderBookRoute(app: FastifyInstance, provider: MarketDataProvider, fetchBook?: OrderBookFetcher): void {
  app.get<{ Params: { code: string } }>('/api/orderbook/:code', async (req, reply) => {
    if (!fetchBook) return reply.code(404).send({ error: '호가를 주는 시세 소스가 없어요' });
    const stock = await provider.getStock(req.params.code);
    if (!stock) return reply.code(404).send({ error: '종목을 찾을 수 없어요' });
    try {
      const book = await fetchBook(stock);
      if (!book || (book.asks.length === 0 && book.bids.length === 0)) return reply.code(404).send({ error: '호가가 없어요' });
      return { book };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
}
