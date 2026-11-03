import type { Candle, CandleInterval, DataStatus, IndexQuote, Market, Quote, RankingItem, RankingType, StockInfo } from '@stock/shared';

/**
 * 시세 공급자 공통 인터페이스. 구현체만 바꿔 끼우면 됨.
 * - MockProvider: 개발·테스트용 가짜 시세
 * - LiveProvider: 실제 시세 (한국=네이버→야후, 미국=야후)
 */
export interface MarketDataProvider {
  readonly name: string;
  start(): Promise<void>;
  stop(): void;
  status(): DataStatus;
  listStocks(): Promise<StockInfo[]>;
  getStock(code: string): Promise<StockInfo | undefined>;
  getQuotes(codes: string[]): Promise<Quote[]>;
  getCandles(code: string, interval: CandleInterval, limit: number): Promise<Candle[]>;
  getIndices(): Promise<IndexQuote[]>;
  /** 급상승·급하락·거래대금 순위 (market 없으면 국내+미국) */
  getRankings(type: RankingType, market?: Market): Promise<RankingItem[]>;
  /** 원/달러 기준환율 */
  getUsdKrw(): Promise<number>;
  /** 자주 갱신할 종목. owner별로 따로 등록 (예: 'screens' 화면에 보이는 종목, 'orders' 미체결 주문) */
  watch(owner: string, codes: Iterable<string>): void;
  /** 시세가 바뀔 때마다 호출. 반환값은 구독 해제 함수 */
  onQuote(listener: (quote: Quote) => void): () => void;
}
