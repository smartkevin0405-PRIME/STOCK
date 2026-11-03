// 앱 전체(웹·서버·규칙 엔진)가 같이 쓰는 타입

export type Market = 'KR' | 'US';
export type Currency = 'KRW' | 'USD';
export type Exchange = 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | 'NYSE' | 'AMEX';

export interface StockInfo {
  /** 한국: 6자리 종목코드, 미국: 티커 */
  code: string;
  market: Market;
  exchange: Exchange;
  nameKo: string;
  nameEn: string;
  currency: Currency;
  /** 검색용 별칭 (예: AAPL → "애플") */
  aliases?: string[];
  /** 네이버 해외주식 코드 (예: AAPL.O, BRKb) */
  naverCode?: string;
}

export interface Quote {
  code: string;
  price: number;
  prevClose: number;
  /** 시세 소스에 따라 없을 수 있음 */
  open?: number;
  high?: number;
  low?: number;
  volume: number;
  /** price - prevClose */
  change: number;
  /** (price - prevClose) / prevClose, 0.0123 = +1.23% */
  changeRate: number;
  /** 매도1호가 / 매수1호가 — 호가를 주는 시세 소스에서만 */
  ask?: number;
  bid?: number;
  /** epoch ms */
  timestamp: number;
  /** 지연 시세 여부 (분 단위) */
  delayMinutes?: number;
}

export type CandleInterval = '1m' | '5m' | '15m' | '60m' | '1d' | '1w' | '1M';

export interface Candle {
  /** epoch seconds (봉 시작 시각) */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changeRate: number;
}

export type MarketSessionState = 'open' | 'closed';

export interface MarketStatus {
  market: Market;
  state: MarketSessionState;
  /** 다음 장 시작 (epoch ms) — 장중이면 다음 날 개장 */
  nextOpen: number;
  /** 장중일 때 마감 시각 (epoch ms) */
  closeAt?: number;
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderStatus = 'pending' | 'reserved' | 'filled' | 'cancelled' | 'rejected';

export interface Order {
  id: string;
  code: string;
  market: Market;
  side: OrderSide;
  type: OrderType;
  qty: number;
  /** 지정가 주문일 때만 */
  limitPrice?: number;
  status: OrderStatus;
  createdAt: number;
}

export interface Fill {
  orderId: string;
  code: string;
  side: OrderSide;
  price: number;
  qty: number;
  /** price * qty */
  amount: number;
  commission: number;
  tax: number;
  currency: Currency;
  executedAt: number;
}

export interface Position {
  code: string;
  qty: number;
  avgPrice: number;
  currency: Currency;
}

export interface Cash {
  KRW: number;
  USD: number;
}

/** 서버 → 웹 WebSocket 메시지 */
export type ServerMessage =
  | { type: 'quote'; quote: Quote }
  | { type: 'indices'; indices: IndexQuote[] };

/** 웹 → 서버 WebSocket 메시지 */
export type ClientMessage = { type: 'subscribe'; codes: string[] };

export type RankingType = 'gainers' | 'losers' | 'turnover';

export interface RankingItem {
  stock: StockInfo;
  quote: Quote;
}

export function currencyOf(market: Market): Currency {
  return market === 'KR' ? 'KRW' : 'USD';
}

/** 시장별 시세 소스 상태 (화면에 "실시간 / 20분 지연" 표시용) */
export interface SourceStatus {
  /** 지금 시세를 주고 있는 소스 (예: naver, yahoo, mock) */
  source: string;
  /** 0이면 실시간 */
  delayMinutes: number;
  /** 최근 요청이 성공했는지 */
  ok: boolean;
}

export interface DataStatus {
  provider: string;
  KR: SourceStatus;
  US: SourceStatus;
}
