import type {
  AccountView,
  Candle,
  CandleInterval,
  Currency,
  DataStatus,
  Fill,
  FxTrade,
  IndexQuote,
  Market,
  MarketStatus,
  Order,
  OrderSide,
  OrderType,
  Quote,
  RankingItem,
  RankingType,
  SeasonSummary,
  StockInfo,
} from '@stock/shared';

export type { RankingType };

/** APK(Capacitor)에서는 서버 주소를 환경변수로 지정 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

/** 서버가 준 이유를 그대로 담은 오류 (화면에 바로 표시) */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(data.error ?? `요청 실패 (${res.status})`, res.status, data.code);
  return data;
}

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
  account: () => get<AccountView & { stocks: Record<string, StockInfo> }>('/api/account'),
  resetAccount: () => send<AccountView>('POST', '/api/account/reset'),
  seasons: () => get<{ seasons: SeasonSummary[] }>('/api/seasons'),
  orders: (status: 'open' | 'all' = 'all') => get<{ orders: Order[]; stocks: Record<string, StockInfo> }>(`/api/orders?status=${status}`),
  placeOrder: (o: { code: string; side: OrderSide; type: OrderType; qty: number; limitPrice?: number }) =>
    send<{ order: Order; fill?: Fill }>('POST', '/api/orders', o),
  cancelOrder: (id: string) => send<{ order: Order }>('POST', `/api/orders/${id}/cancel`),
  amendOrder: (id: string, patch: { qty?: number; limitPrice?: number }) => send<{ order: Order }>('PATCH', `/api/orders/${id}`, patch),
  fills: (code?: string) => get<{ fills: Fill[]; stocks: Record<string, StockInfo> }>(`/api/fills${code ? `?code=${encodeURIComponent(code)}` : ''}`),
  exchange: (from: Currency, amount: number) => send<{ trade: FxTrade }>('POST', '/api/fx', { from, amount }),
  fxTrades: () => get<{ trades: FxTrade[] }>('/api/fx/trades'),
  rankings: (type: RankingType, market?: Market) =>
    get<{ items: RankingItem[] }>(`/api/rankings?type=${type}${market ? `&market=${market}` : ''}`),
};
