import { getMarketStatus, searchStocks } from '@stock/core';
import type { CandleInterval } from '@stock/shared';
import type { FastifyInstance } from 'fastify';
import type { MarketDataProvider } from './provider';

const INTERVALS: readonly CandleInterval[] = ['1m', '5m', '15m', '60m', '1d', '1w', '1M'];

/** 시세 API: 검색·종목·시세·차트·지수·장 상태·순위 */
export function registerMarketRoutes(app: FastifyInstance, provider: MarketDataProvider, health: Record<string, unknown> = {}): void {
  const withQuotes = async (codes: string[]) => {
    const quotes = await provider.getQuotes(codes);
    return new Map(quotes.map((q) => [q.code, q]));
  };

  app.get('/api/health', async () => ({ ok: true, ...health, ...provider.status() }));

  // 검색 (q 없으면 전체)
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/stocks', async (req) => {
    const all = await provider.listStocks();
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const q = req.query.q?.trim() ?? '';
    const stocks = q ? searchStocks(all, q, limit) : all.slice(0, limit);
    const quotes = await withQuotes(stocks.map((s) => s.code));
    return { items: stocks.map((stock) => ({ stock, quote: quotes.get(stock.code) ?? null })) };
  });

  app.get<{ Params: { code: string } }>('/api/stocks/:code', async (req, reply) => {
    const stock = await provider.getStock(req.params.code);
    if (!stock) return reply.code(404).send({ error: '종목을 찾을 수 없어요' });
    const [quote] = await provider.getQuotes([stock.code]);
    return { stock, quote: quote ?? null };
  });

  app.get<{ Querystring: { codes?: string } }>('/api/quotes', async (req) => {
    const codes = (req.query.codes ?? '').split(',').map((c) => c.trim()).filter(Boolean).slice(0, 100);
    return { quotes: await provider.getQuotes(codes) };
  });

  app.get<{ Params: { code: string }; Querystring: { interval?: string; limit?: string } }>(
    '/api/candles/:code',
    async (req, reply) => {
      const interval = (req.query.interval ?? '1d') as CandleInterval;
      if (!INTERVALS.includes(interval)) return reply.code(400).send({ error: `interval은 ${INTERVALS.join(', ')} 중 하나` });
      const limit = Math.min(Number(req.query.limit) || 300, 1_000);
      return { candles: await provider.getCandles(req.params.code, interval, limit) };
    },
  );

  app.get('/api/indices', async () => ({
    indices: await provider.getIndices(),
    usdKrw: await provider.getUsdKrw(),
  }));

  app.get('/api/market-status', async () => ({
    KR: getMarketStatus('KR'),
    US: getMarketStatus('US'),
  }));

  // 순위: 급상승·급하락·거래대금
  app.get<{ Querystring: { type?: string; market?: string } }>('/api/rankings', async (req, reply) => {
    const type = (['gainers', 'losers', 'turnover'] as const).find((t) => t === req.query.type) ?? 'gainers';
    const market = req.query.market === 'KR' || req.query.market === 'US' ? req.query.market : undefined;
    try {
      return { items: await provider.getRankings(type, market) };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
}
