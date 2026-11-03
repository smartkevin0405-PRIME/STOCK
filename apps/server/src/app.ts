import websocket from '@fastify/websocket';
import { getMarketStatus, searchStocks } from '@stock/core';
import type { CandleInterval, ClientMessage, Quote, ServerMessage } from '@stock/shared';
import Fastify from 'fastify';
import type { MarketDataProvider } from './market/provider';
import { registerTradingRoutes } from './trading/routes';
import type { TradingService } from './trading/service';

const INTERVALS: readonly CandleInterval[] = ['1m', '5m', '15m', '60m', '1d', '1w', '1M'];

export interface AppOptions {
  provider: MarketDataProvider;
  /** 모의투자 계좌 (없으면 시세 API만) */
  trading?: TradingService;
  logger?: boolean;
  /** 지수 브로드캐스트 간격 (ms) */
  indicesIntervalMs?: number;
}

export async function buildApp({ provider, trading, logger = false, indicesIntervalMs = 3_000 }: AppOptions) {
  const app = Fastify({ logger });
  await app.register(websocket);
  if (trading) registerTradingRoutes(app, trading, provider);

  const withQuotes = async (codes: string[]) => {
    const quotes = await provider.getQuotes(codes);
    return new Map(quotes.map((q) => [q.code, q]));
  };

  app.get('/api/health', async () => ({ ok: true, ...provider.status() }));

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

  // 실시간: 구독한 종목 시세 + 주기적 지수
  const clients = new Set<{ send: (m: ServerMessage) => void; codes: Set<string> }>();
  const syncWatch = () => {
    const all = new Set<string>();
    for (const c of clients) for (const code of c.codes) all.add(code);
    provider.watch('screens', all);
  };

  const offQuote = provider.onQuote((quote: Quote) => {
    for (const c of clients) if (c.codes.has(quote.code)) c.send({ type: 'quote', quote });
  });
  const indicesTimer = setInterval(async () => {
    if (clients.size === 0) return;
    const indices = await provider.getIndices();
    for (const c of clients) c.send({ type: 'indices', indices });
  }, indicesIntervalMs);

  // 체결·주문·환전·리셋 알림은 모든 화면에
  const offAccount = trading?.onEvent((e) => {
    for (const c of clients) c.send({ type: 'account', ...e });
  });

  app.addHook('onClose', async () => {
    offAccount?.();
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
          syncWatch();
        }
      } catch {
        // 잘못된 메시지는 무시
      }
    });
    socket.on('close', () => {
      clients.delete(client);
      syncWatch();
    });
  });

  return app;
}
