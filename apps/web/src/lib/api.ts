import type {
  AccountView,
  AchievementsView,
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
import type { CoachReport, DrawdownResult, TradeStats } from '@stock/core';
import { isLocalMock, isLocalMode, serverBase } from './server';
import { getToken, unauthorized } from './auth';

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

/** 로그인 토큰을 붙여서 요청. 401이면 로그인 화면으로 */
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  // 서버 없이 쓰기: 앱 안에서 처리 (처음 한 번 불러옴)
  if (isLocalMode()) {
    const local = await import('../local/backend');
    local.startLocal(isLocalMock());
    return local.localFetch(path, init);
  }
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(API_BASE + path, { ...init, headers });
  if (res.status === 401 && path !== '/api/login') unauthorized();
  return res;
}

/** 다른 모듈에서 서버를 직접 부를 때도 이걸로 (로그인 토큰이 붙음) */
export const apiFetch = request;

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await request(path, {
    method,
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(data.error ?? `요청 실패 (${res.status})`, res.status, data.code);
  return data;
}

async function get<T>(path: string): Promise<T> {
  const res = await request(path);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `요청 실패 (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export type StatsPeriod = 'all' | 'month' | 'week';

/** 서버 trading/stats.ts의 StatsView와 같은 모양 */
export interface StatsView {
  period: StatsPeriod;
  from?: number;
  trades: TradeStats;
  /** 맨 끝은 지금 (day = 'now') */
  equity: { day: string; totalKrw: number }[];
  drawdown: DrawdownResult | null;
  calendar: { day: string; pnlKrw: number }[];
  tax: { year: number; usRealizedKrw: number; deductionKrw: number; taxableKrw: number; estimatedTaxKrw: number };
  usdKrw: number;
}

export interface CoachView {
  report: CoachReport;
  concentration: { code: string; weight: number; triggered: boolean } | null;
  stopLossRate?: number;
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
  health: () => get<{ ok: boolean; auth?: boolean } & DataStatus>('/api/health'),
  login: (password: string) => send<{ token: string }>('POST', '/api/login', { password }),
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
  stats: (period: StatsPeriod) => get<StatsView>(`/api/stats?period=${period}`),
  benchmarks: (from: number) => get<{ series: { symbol: string; name: string; candles: Candle[] }[] }>(`/api/benchmarks?from=${from}`),
  coach: () => get<CoachView>('/api/coach'),
  settings: () => get<{ stopLossRate: number | null }>('/api/settings'),
  saveSettings: (s: { stopLossRate: number | null }) => send<{ stopLossRate: number | null }>('PUT', '/api/settings', s),
  fcmInfo: () => get<{ enabled: boolean; devices: number }>('/api/push/fcm'),
  fcmRegister: (token: string) => send<{ devices: number }>('POST', '/api/push/fcm', { token }),
  fcmUnregister: (token: string) => send<{ devices: number }>('POST', '/api/push/fcm/unregister', { token }),
  journal: () => get<{ entries: JournalEntry[]; stocks: Record<string, StockInfo> }>('/api/journal'),
  saveNote: (orderId: string, note: JournalNote) => send<{ note: JournalNote }>('PUT', `/api/journal/${orderId}`, note),
  exchange: (from: Currency, amount: number) => send<{ trade: FxTrade }>('POST', '/api/fx', { from, amount }),
  fxTrades: () => get<{ trades: FxTrade[] }>('/api/fx/trades'),
  achievements: () => get<AchievementsView>('/api/achievements'),
  rankings: (type: RankingType, market?: Market) =>
    get<{ items: RankingItem[] }>(`/api/rankings?type=${type}${market ? `&market=${market}` : ''}`),
};
