import type { IndexQuote } from '@stock/shared';
import { fetchNaverKrIndices } from './naver';
import type { MarketExtrasSource } from './sources';
import { YAHOO_INDICES, fetchYahooMetas, metaToIndex } from './yahoo';

/** 지수·환율: 야후로 전부 받고, 코스피·코스닥은 네이버 실시간 값으로 덮어씀 */
export class LiveExtras implements MarketExtrasSource {
  readonly name = 'naver+yahoo';

  async fetchIndices(): Promise<IndexQuote[]> {
    const [yahoo, naver] = await Promise.allSettled([
      fetchYahooMetas(YAHOO_INDICES.map((i) => i.symbol)),
      fetchNaverKrIndices(),
    ]);
    const naverBySymbol = new Map(naver.status === 'fulfilled' ? naver.value.map((i) => [i.symbol, i]) : []);
    const out = YAHOO_INDICES.flatMap(({ symbol, name }) => {
      const fromNaver = naverBySymbol.get(symbol);
      if (fromNaver) return [fromNaver];
      const meta = yahoo.status === 'fulfilled' ? yahoo.value.get(symbol) : undefined;
      const idx = meta ? metaToIndex(symbol, name, meta) : null;
      return idx ? [idx] : [];
    });
    if (out.length === 0) throw new Error('지수를 불러오지 못했어요');
    return out;
  }

  async fetchUsdKrw(): Promise<number> {
    const metas = await fetchYahooMetas(['KRW=X']);
    const price = metas.get('KRW=X')?.regularMarketPrice;
    if (!price) throw new Error('환율을 불러오지 못했어요');
    return price;
  }
}
