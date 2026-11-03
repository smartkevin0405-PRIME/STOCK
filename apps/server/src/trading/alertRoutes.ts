import type { AlertKind, PriceAlert, StockInfo } from '@stock/shared';
import type { FastifyInstance } from 'fastify';
import type { MarketDataProvider } from '../market/provider';
import { describeAlert, moneyText, type AlertService } from './alerts';
import type { PushService } from './push';
import { TradingError, type TradingService } from './service';

const isKind = (v: unknown): v is AlertKind => v === 'above' || v === 'below' || v === 'rise' || v === 'fall';

export interface NotifierOptions {
  provider: MarketDataProvider;
  alerts: AlertService;
  push?: PushService;
  trading?: TradingService;
  /** 앱 화면(WebSocket)으로도 알려줄 때 */
  broadcast?: (alert: PriceAlert, stock?: StockInfo) => void;
}

/**
 * 알림 연결:
 * - 시세가 바뀌면 가격 알림 확인 → 울리면 폰 푸시 + 앱 화면 알림
 * - 대기·예약 주문이 나중에 체결되면 폰 푸시
 */
export function startNotifier({ provider, alerts, push, trading, broadcast }: NotifierOptions): () => void {
  const syncWatch = () => provider.watch('alerts', alerts.activeCodes());
  syncWatch();

  const offQuote = provider.onQuote((q) => {
    if (alerts.check(q).length) syncWatch();
  });

  const offTrigger = alerts.onTrigger((a) => {
    void provider.getStock(a.code).then((stock) => {
      broadcast?.(a, stock);
      const name = stock?.nameKo ?? a.code;
      void push?.notify({
        title: `${name} 가격 알림`,
        body: `${describeAlert(a, stock)} 도달 · 지금 ${moneyText(a.triggeredPrice ?? 0, stock)}`,
        url: `/#/stock/${a.code}`,
        tag: `alert-${a.id}`,
      });
    });
  });

  const offFill = trading?.onEvent((e) => {
    if (e.event !== 'fill' || !e.background) return;
    const f = e.fill;
    void push?.notify({
      title: '주문 체결',
      body: `${e.stock?.nameKo ?? f.code} ${f.qty.toLocaleString()}주 ${f.side === 'buy' ? '구매' : '판매'} 체결`,
      url: `/#/stock/${f.code}`,
      tag: `fill-${f.orderId}`,
    });
  });

  return () => {
    offQuote();
    offTrigger();
    offFill?.();
  };
}

/** 가격 알림 + 폰 푸시 구독 API */
export function registerAlertRoutes(app: FastifyInstance, o: { provider: MarketDataProvider; alerts: AlertService; push?: PushService }): void {
  const { provider, alerts, push } = o;
  const withStocks = async () => {
    const list = alerts.list();
    const stocks = await Promise.all([...new Set(list.map((a) => a.code))].map((c) => provider.getStock(c)));
    return { alerts: list, stocks: Object.fromEntries(stocks.flatMap((s) => (s ? [[s.code, s]] : []))) };
  };

  app.get('/api/alerts', withStocks);

  app.post<{ Body: { code?: unknown; kind?: unknown; value?: unknown } }>('/api/alerts', async (req, reply) => {
    const { code, kind, value } = req.body ?? {};
    if (typeof code !== 'string' || !isKind(kind) || typeof value !== 'number') throw new TradingError('BAD_REQUEST', '알림 내용이 올바르지 않아요');
    if (!(await provider.getStock(code))) throw new TradingError('NOT_FOUND', '종목을 찾을 수 없어요', 404);
    const [quote] = await provider.getQuotes([code]);
    if (!quote) throw new TradingError('NO_QUOTE', '시세를 불러오지 못했어요. 잠시 후 다시 시도해주세요', 503);
    alerts.create({ code, kind, value }, quote);
    provider.watch('alerts', alerts.activeCodes());
    return reply.code(201).send(await withStocks());
  });

  app.delete<{ Params: { id: string } }>('/api/alerts/:id', async (req) => {
    alerts.remove(Number(req.params.id));
    provider.watch('alerts', alerts.activeCodes());
    return withStocks();
  });

  app.get('/api/push', async () => ({ enabled: !!push, publicKey: push?.publicKey ?? null, devices: push?.count() ?? 0 }));

  app.post<{ Body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } }>('/api/push/subscribe', async (req, reply) => {
    if (!push) throw new TradingError('PUSH_OFF', '서버에 푸시 설정이 없어요', 503);
    const { endpoint, keys } = req.body ?? {};
    if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || typeof keys?.p256dh !== 'string' || typeof keys.auth !== 'string') {
      throw new TradingError('BAD_REQUEST', '푸시 구독 정보가 올바르지 않아요');
    }
    push.subscribe({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
    return reply.code(201).send({ devices: push.count() });
  });

  app.post<{ Body: { endpoint?: unknown } }>('/api/push/unsubscribe', async (req) => {
    if (push && typeof req.body?.endpoint === 'string') push.unsubscribe(req.body.endpoint);
    return { devices: push?.count() ?? 0 };
  });

  app.post('/api/push/test', async () => {
    if (!push) throw new TradingError('PUSH_OFF', '서버에 푸시 설정이 없어요', 503);
    const sent = await push.notify({ title: 'STOCK 알림 테스트', body: '이렇게 알림이 와요 👋', url: '/#/more', tag: 'test' });
    if (sent === 0) throw new TradingError('NO_DEVICE', '알림을 받을 기기가 없어요. 먼저 알림을 켜주세요');
    return { sent };
  });
}
