import type {
  AccountView,
  AlertKind,
  Candle,
  CandleInterval,
  Currency,
  DataStatus,
  Fill,
  FxTrade,
  IndexQuote,
  JournalEntry,
  JournalNote,
  Market,
  MarketStatus,
  Order,
  OrderSide,
  OrderType,
  PriceAlert,
  Quote,
  RankingItem,
  RankingType,
  SeasonSummary,
  StockInfo,
  WatchGroup,
} from '@stock/shared';
import { serverBase } from './server';

export type { RankingType };

/** 서버 주소 (앱에서 정한 값 → VITE_API_BASE → 같은 주소). 바꾸면 새로고침 */
export const API_BASE: string = serverBase();

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

export interface AlertsData {
  alerts: PriceAlert[];
  stocks: Record<string, StockInfo>;
}

export interface WatchlistData {
  groups: WatchGroup[];
  stocks: Record<string, StockInfo>;
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
  placeOrder: (o: { code: string; side: OrderSide; type: OrderType; qty: number; limitPrice?: number; note?: JournalNote }) =>
    send<{ order: Order; fill?: Fill }>('POST', '/api/orders', o),
  cancelOrder: (id: string) => send<{ order: Order }>('POST', `/api/orders/${id}/cancel`),
  amendOrder: (id: string, patch: { qty?: number; limitPrice?: number }) => send<{ order: Order }>('PATCH', `/api/orders/${id}`, patch),
  fills: (code?: string) => get<{ fills: Fill[]; stocks: Record<string, StockInfo> }>(`/api/fills${code ? `?code=${encodeURIComponent(code)}` : ''}`),
  watchlists: () => get<WatchlistData>('/api/watchlists'),
  createWatchGroup: (name: string) => send<WatchlistData>('POST', '/api/watchlists', { name }),
  updateWatchGroup: (id: number, patch: { name?: string; codes?: string[] }) => send<WatchlistData>('PATCH', `/api/watchlists/${id}`, patch),
  deleteWatchGroup: (id: number) => send<WatchlistData>('DELETE', `/api/watchlists/${id}`),
  addWatch: (id: number, code: string) => send<WatchlistData>('POST', `/api/watchlists/${id}/items`, { code }),
  removeWatch: (id: number, code: string) => send<WatchlistData>('DELETE', `/api/watchlists/${id}/items/${encodeURIComponent(code)}`),
  alerts: () => get<AlertsData>('/api/alerts'),
  createAlert: (a: { code: string; kind: AlertKind; value: number }) => send<AlertsData>('POST', '/api/alerts', a),
  deleteAlert: (id: number) => send<AlertsData>('DELETE', `/api/alerts/${id}`),
  pushInfo: () => get<{ enabled: boolean; publicKey: string | null; devices: number }>('/api/push'),
  pushSubscribe: (sub: PushSubscriptionJSON) => send<{ devices: number }>('POST', '/api/push/subscribe', sub),
  pushUnsubscribe: (endpoint: string) => send<{ devices: number }>('POST', '/api/push/unsubscribe', { endpoint }),
  pushTest: () => send<{ sent: number }>('POST', '/api/push/test'),
  fcmInfo: () => get<{ enabled: boolean; devices: number }>('/api/push/fcm'),
  fcmRegister: (token: string) => send<{ devices: number }>('POST', '/api/push/fcm', { token }),
  fcmUnregister: (token: string) => send<{ devices: number }>('POST', '/api/push/fcm/unregister', { token }),
  journal: () => get<{ entries: JournalEntry[]; stocks: Record<string, StockInfo> }>('/api/journal'),
  saveNote: (orderId: string, note: JournalNote) => send<{ note: JournalNote }>('PUT', `/api/journal/${orderId}`, note),
  exchange: (from: Currency, amount: number) => send<{ trade: FxTrade }>('POST', '/api/fx', { from, amount }),
  fxTrades: () => get<{ trades: FxTrade[] }>('/api/fx/trades'),
  rankings: (type: RankingType, market?: Market) =>
    get<{ items: RankingItem[] }>(`/api/rankings?type=${type}${market ? `&market=${market}` : ''}`),
};
