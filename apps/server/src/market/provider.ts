import type { Candle, CandleInterval, IndexQuote, Quote, StockInfo } from '@stock/shared';

/**
 * 시세 소스 공통 인터페이스. 구현체만 바꿔 끼우면 됨.
 * - MockProvider: 개발·테스트용 가짜 시세 (M0)
 * - YahooProvider: 야후 파이낸스 (M1)
 * - KisProvider: 한국투자증권 (선택)
 */
export interface MarketDataProvider {
  readonly name: string;
  /** 지연 시세면 분 단위, 실시간이면 0 */
  readonly delayMinutes: number;
  start(): Promise<void>;
  stop(): void;
  listStocks(): Promise<StockInfo[]>;
  getStock(code: string): Promise<StockInfo | undefined>;
  getQuotes(codes: string[]): Promise<Quote[]>;
  getCandles(code: string, interval: CandleInterval, limit: number): Promise<Candle[]>;
  getIndices(): Promise<IndexQuote[]>;
  /** 원/달러 기준환율 */
  getUsdKrw(): Promise<number>;
  /** 시세가 바뀔 때마다 호출. 반환값은 구독 해제 함수 */
  onQuote(listener: (quote: Quote) => void): () => void;
}
