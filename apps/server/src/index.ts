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
import { TradingService } from './trading/service';
import { FallbackSource } from './market/sources';
import { YahooSource } from './market/yahoo';

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
  });
}

await provider.start();
const trading = new TradingService({ db: openDb(join(dataDir, mode === 'mock' ? 'mock.db' : 'stock.db')), provider });
trading.start();
const app = await buildApp({ provider, trading, logger: true });
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
