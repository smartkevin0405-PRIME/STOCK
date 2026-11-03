import type { ServerMessage } from '@stock/shared';
import type { DatabaseSync } from 'node:sqlite';
import { registerAiRoutes } from '../../../server/src/ai/routes';
import { createLiveProvider } from '../../../server/src/market/createLive';
import { MockProvider } from '../../../server/src/market/mock';
import { registerOrderBookRoute } from '../../../server/src/market/orderbookRoutes';
import type { MarketDataProvider } from '../../../server/src/market/provider';
import { registerMarketRoutes } from '../../../server/src/market/routes';
import { createRealtime, type RealtimeClient } from '../../../server/src/realtime';
import { registerReplayRoutes } from '../../../server/src/replay/routes';
import { ReplayStore } from '../../../server/src/replay/store';
import { registerAchievementRoutes } from '../../../server/src/trading/achievementRoutes';
import { AchievementService } from '../../../server/src/trading/achievements';
import { registerAlertRoutes } from '../../../server/src/trading/alertRoutes';
import { AlertService } from '../../../server/src/trading/alerts';
import { CorporateActions, fetchYahooEvents } from '../../../server/src/trading/corporate';
import { registerFcmRoutes } from '../../../server/src/trading/fcmRoutes';
import { registerTradingRoutes } from '../../../server/src/trading/routes';
import { TradingService } from '../../../server/src/trading/service';
import { WatchlistService } from '../../../server/src/trading/watchlist';
import { idbStore } from './idb';
import { LocalRouter } from './router';
import { openLocalDb } from './sqlDb';

/**
 * 서버 없이 쓰기: 서버 코드를 앱 안에서 그대로 실행.
 * 시세는 폰이 네이버·야후에서 직접 받고, 계좌는 기기 안 SQLite(IndexedDB 저장)에.
 */
async function boot(mock: boolean) {
  const store = idbStore('stock-local');
  const db = (await openLocalDb({ load: () => store.load('db'), save: (bytes) => store.save('db', bytes) })) as unknown as DatabaseSync;

  let provider: MarketDataProvider;
  if (mock) {
    provider = new MockProvider();
  } else {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const live = createLiveProvider({
      storage: {
        read: async () => {
          const bytes = await store.load('stocks');
          return bytes ? dec.decode(bytes) : null;
        },
        write: (text) => store.save('stocks', enc.encode(text)),
      },
    });
    await live.store.start();
    provider = live.provider;
  }
  await provider.start();

  const trading = new TradingService({ db, provider });
  trading.start();
  const alerts = new AlertService(db);
  const achievements = new AchievementService({ trading });

  const router = new LocalRouter();
  const app = router.asFastify();
  registerMarketRoutes(app, provider, { auth: false, local: true });
  registerTradingRoutes(app, trading, provider, new WatchlistService(db));
  registerAiRoutes(app, { trading, provider, ai: null });
  registerAlertRoutes(app, { provider, alerts });
  registerAchievementRoutes(app, achievements);
  registerReplayRoutes(app, { provider, store: new ReplayStore(db) });
  registerOrderBookRoute(app, provider);
  registerFcmRoutes(app);

  const realtime = createRealtime({ provider, trading, alerts, achievements });

  // 배당·액면분할: 켤 때 + 6시간마다
  if (!mock) {
    const corporate = new CorporateActions(trading, provider, fetchYahooEvents);
    const run = () => void corporate.run().catch(() => undefined);
    run();
    setInterval(run, 6 * 3_600_000);
  }

  // 앱이 백그라운드에서 돌아오면 바로 밀린 주문·기록 처리
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void trading.processOpenOrders().catch(() => undefined);
      void trading.snapshotIfDue().catch(() => undefined);
    }
  });

  return { router, realtime };
}

let booting: ReturnType<typeof boot> | undefined;
let bootMock = false;

/** 처음 부를 때 한 번만 시작 */
export function startLocal(mock = false) {
  bootMock = mock;
  booting ??= boot(mock);
  return booting;
}

/** apiFetch 대신 */
export async function localFetch(path: string, init?: RequestInit): Promise<Response> {
  const { router } = await startLocal(bootMock);
  return router.handle(path, init);
}

/** WebSocket 대신 */
export async function localConnect(send: (m: ServerMessage) => void): Promise<RealtimeClient> {
  const { realtime } = await startLocal(bootMock);
  return realtime.connect(send);
}
