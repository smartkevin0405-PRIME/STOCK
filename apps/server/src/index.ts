import { join } from 'node:path';
import { buildApp } from './app';
import { StockDirectory } from './market/directory';
import { DirectoryStore } from './market/directoryStore';
import { LiveExtras } from './market/extras';
import { LiveProvider } from './market/live';
import { MockProvider } from './market/mock';
import { SEED_STOCKS } from './market/mockStocks';
import { NaverSource, fetchNaverDirectory, fetchNaverRankings } from './market/naver';
import type { MarketDataProvider } from './market/provider';
import { openDb } from './trading/db';
import { AlertService } from './trading/alerts';
import { fcmFromEnv } from './trading/fcm';
import { PushService, loadVapidKeys } from './trading/push';
import { TradingService } from './trading/service';
import { WatchlistService } from './trading/watchlist';
import { FallbackSource } from './market/sources';
import { YahooSource, fetchYahooDaily } from './market/yahoo';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
/** live(기본): 네이버·야후 실제 시세 / mock: 가짜 시세 */
const mode = process.env.MARKET_DATA ?? 'live';
const dataDir = process.env.DATA_DIR ?? join(process.cwd(), 'data');

let store: DirectoryStore | undefined;
let provider: MarketDataProvider;

if (mode === 'mock') {
  provider = new MockProvider();
} else {
  const directory = new StockDirectory(SEED_STOCKS);
  store = new DirectoryStore({
    directory,
    file: join(dataDir, 'stocks.json'),
    fetchAll: () => fetchNaverDirectory(),
    minCount: 1_000,
    log: (m) => console.log(`[stocks] ${m}`),
  });
  await store.start();
  provider = new LiveProvider({
    directory,
    // 순서대로 시도: 앞 소스가 막히거나 못 주는 종목은 다음 소스로
    sources: {
      KR: new FallbackSource([new NaverSource('KR'), new YahooSource('KR')]),
      US: new FallbackSource([new NaverSource('US'), new YahooSource('US')]),
    },
    extras: new LiveExtras(),
    rankings: (type, market) => fetchNaverRankings(type, market),
    indexHistory: fetchYahooDaily,
  });
}

await provider.start();
const db = openDb(join(dataDir, mode === 'mock' ? 'mock.db' : 'stock.db'));
const trading = new TradingService({ db, provider });
trading.start();
// 폰 푸시 키: 처음 실행 때 만들어 DATA_DIR/vapid.json에 저장 (환경변수 VAPID_PUBLIC_KEY/PRIVATE_KEY로 지정 가능)
const vapid = loadVapidKeys(join(dataDir, 'vapid.json'));
// 푸시 서비스가 문제 있을 때 연락할 주소 (배포할 때 본인 주소로 바꾸기)
const push = new PushService(db, vapid.publicKey, PushService.webPushSender(vapid, process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com'));
// 안드로이드 앱 푸시: FIREBASE_SERVICE_ACCOUNT = 서비스 계정 JSON 파일 경로 (없으면 꺼짐)
push.fcm = fcmFromEnv(db);
const app = await buildApp({ provider, trading, watchlists: new WatchlistService(db), alerts: new AlertService(db), push, logger: true });
await app.listen({ port, host });

const shutdown = async () => {
  trading.stop();
  provider.stop();
  store?.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
