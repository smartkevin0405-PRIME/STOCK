import websocket from '@fastify/websocket';
import { getMarketStatus, searchStocks } from '@stock/core';
import type { CandleInterval, ClientMessage, Quote, ServerMessage } from '@stock/shared';
import Fastify from 'fastify';
import type { MarketDataProvider } from './market/provider';

const INTERVALS: readonly CandleInterval[] = ['1m', '5m', '15m', '60m', '1d', '1w', '1M'];

export interface AppOptions {
  provider: MarketDataProvider;
  logger?: boolean;
  /** 지수 브로드캐스트 간격 (ms) */
  indicesIntervalMs?: number;
}

export async function buildApp({ provider, logger = false, indicesIntervalMs = 3_000 }: AppOptions) {
  const app = Fastify({ logger });
  await app.register(websocket);

  const withQuotes = async (codes: string[]) => {
    const quotes = await provider.getQuotes(codes);
    return new Map(quotes.map((q) => [q.code, q]));
  };

  app.get('/api/health', async () => ({ ok: true, provider: provider.name, delayMinutes: provider.delayMinutes }));

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

  // 순위: 상승률·하락률·거래대금
  app.get<{ Querystring: { type?: string; market?: string } }>('/api/rankings', async (req) => {
    const type = req.query.type ?? 'gainers';
    const stocks = (await provider.listStocks()).filter((s) => !req.query.market || s.market === req.query.market);
    const quotes = await withQuotes(stocks.map((s) => s.code));
    const usdKrw = await provider.getUsdKrw();
    const items = stocks.flatMap((stock) => {
      const quote = quotes.get(stock.code);
      return quote ? [{ stock, quote }] : [];
    });
    const turnover = (x: (typeof items)[number]) => x.quote.price * x.quote.volume * (x.stock.currency === 'USD' ? usdKrw : 1);
    const sorters: Record<string, (a: (typeof items)[number], b: (typeof items)[number]) => number> = {
      gainers: (a, b) => b.quote.changeRate - a.quote.changeRate,
      losers: (a, b) => a.quote.changeRate - b.quote.changeRate,
      turnover: (a, b) => turnover(b) - turnover(a),
    };
    return { items: items.sort(sorters[type] ?? sorters.gainers).slice(0, 20) };
  });

  // 실시간: 구독한 종목 시세 + 주기적 지수
  const clients = new Set<{ send: (m: ServerMessage) => void; codes: Set<string> }>();

  const offQuote = provider.onQuote((quote: Quote) => {
    for (const c of clients) if (c.codes.has(quote.code)) c.send({ type: 'quote', quote });
  });
  const indicesTimer = setInterval(async () => {
    if (clients.size === 0) return;
    const indices = await provider.getIndices();
    for (const c of clients) c.send({ type: 'indices', indices });
  }, indicesIntervalMs);

  app.addHook('onClose', async () => {
    offQuote();
    clearInterval(indicesTimer);
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const client = {
      codes: new Set<string>(),
      send: (m: ServerMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
      },
    };
    clients.add(client);
    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientMessage;
        if (msg.type === 'subscribe' && Array.isArray(msg.codes)) {
          client.codes = new Set(msg.codes.slice(0, 200).map(String));
        }
      } catch {
        // 잘못된 메시지는 무시
      }
    });
    socket.on('close', () => clients.delete(client));
  });

  return app;
}
