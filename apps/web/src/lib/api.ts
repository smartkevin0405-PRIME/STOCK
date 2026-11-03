import type { Candle, CandleInterval, DataStatus, IndexQuote, Market, MarketStatus, Quote, RankingItem, RankingType, StockInfo } from '@stock/shared';

export type { RankingType };

/** APK(Capacitor)에서는 서버 주소를 환경변수로 지정 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(API_BASE + path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `요청 실패 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface StockWithQuote {
  stock: StockInfo;
  quote: Quote | null;
}

export const api = {
  health: () => get<{ ok: boolean } & DataStatus>('/api/health'),
  search: (q: string, limit = 30) =>
    get<{ items: StockWithQuote[] }>(`/api/stocks?q=${encodeURIComponent(q)}&limit=${limit}`),
  stock: (code: string) => get<StockWithQuote>(`/api/stocks/${encodeURIComponent(code)}`),
  quotes: (codes: string[]) => get<{ quotes: Quote[] }>(`/api/quotes?codes=${codes.map(encodeURIComponent).join(',')}`),
  candles: (code: string, interval: CandleInterval, limit = 300) =>
    get<{ candles: Candle[] }>(`/api/candles/${encodeURIComponent(code)}?interval=${interval}&limit=${limit}`),
  indices: () => get<{ indices: IndexQuote[]; usdKrw: number }>('/api/indices'),
  marketStatus: () => get<Record<Market, MarketStatus>>('/api/market-status'),
  rankings: (type: RankingType, market?: Market) =>
    get<{ items: RankingItem[] }>(`/api/rankings?type=${type}${market ? `&market=${market}` : ''}`),
};
