import { StockDirectory } from './directory';
import { DirectoryStore, type TextStorage } from './directoryStore';
import { LiveExtras } from './extras';
import { LiveProvider } from './live';
import { SEED_STOCKS } from './mockStocks';
import { NaverSource, fetchNaverDirectory, fetchNaverRankings } from './naver';
import { FallbackSource, type QuoteSource } from './sources';
import { YahooSource, fetchYahooDaily } from './yahoo';

/**
 * 실제 시세 (네이버 → 야후 순서로 시도) + 전체 종목 목록 저장소.
 * 서버와 서버 없이 쓰는 앱이 같이 씀
 */
export function createLiveProvider(o: { storage: TextStorage; first?: { KR: QuoteSource; US: QuoteSource }; log?: (m: string) => void }) {
  const directory = new StockDirectory(SEED_STOCKS);
  const store = new DirectoryStore({
    directory,
    storage: o.storage,
    fetchAll: () => fetchNaverDirectory(),
    minCount: 1_000,
    log: o.log,
  });
  const provider = new LiveProvider({
    directory,
    // 순서대로 시도: 앞 소스가 막히거나 못 주는 종목은 다음 소스로
    sources: {
      KR: new FallbackSource([...(o.first ? [o.first.KR] : []), new NaverSource('KR'), new YahooSource('KR')]),
      US: new FallbackSource([...(o.first ? [o.first.US] : []), new NaverSource('US'), new YahooSource('US')]),
    },
    extras: new LiveExtras(),
    rankings: (type, market) => fetchNaverRankings(type, market),
    indexHistory: fetchYahooDaily,
  });
  return { provider, store };
}
