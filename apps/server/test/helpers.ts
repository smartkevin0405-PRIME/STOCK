import type { Candle, DataStatus, Quote, StockInfo } from '@stock/shared';
import type { MarketDataProvider } from '../src/market/provider';

export const SAMSUNG: StockInfo = { code: '005930', market: 'KR', exchange: 'KOSPI', nameKo: '삼성전자', nameEn: '', currency: 'KRW' };
export const APPLE: StockInfo = { code: 'AAPL', market: 'US', exchange: 'NASDAQ', nameKo: '애플', nameEn: 'Apple', currency: 'USD' };

export const KR_OPEN = Date.parse('2026-11-03T01:00:00Z'); // 화 10:00 KST

/** 테스트용 시세: 가격·전일 종가를 직접 정함 */
export class TestProvider implements MarketDataProvider {
  readonly name = 'test';
  prices = new Map<string, number>([['005930', 70_000], ['AAPL', 200]]);
  prevCloses = new Map<string, number>([['005930', 70_000], ['AAPL', 200]]);
  usdKrw = 1_400;
  history: Candle[] = [];
  async start() {}
  stop() {}
  status(): DataStatus {
    const s = { source: 'test', delayMinutes: 0, ok: true };
    return { provider: 'test', KR: s, US: s };
  }
  async listStocks() {
    return [SAMSUNG, APPLE];
  }
  async getStock(code: string) {
    return [SAMSUNG, APPLE].find((s) => s.code === code);
  }
  async getQuotes(codes: string[]): Promise<Quote[]> {
    return codes.flatMap((code) => {
      const price = this.prices.get(code);
      const prevClose = this.prevCloses.get(code) ?? price ?? 1;
      return price === undefined
        ? []
        : [{ code, price, prevClose, volume: 0, change: price - prevClose, changeRate: (price - prevClose) / prevClose, timestamp: 0 }];
    });
  }
  async getCandles() {
    return [];
  }
  async getIndices() {
    return [];
  }
  async getRankings() {
    return [];
  }
  async getUsdKrw() {
    return this.usdKrw;
  }
  async getHistory() {
    return this.history;
  }
  async getIndexHistory() {
    return this.history;
  }
  watch() {}
  onQuote() {
    return () => undefined;
  }
}
