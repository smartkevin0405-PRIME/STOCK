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
  /** 시세 소스가 알려주는 장 상태 (예상 못 한 휴장 확인용) */
  marketStatus?: 'open' | 'closed';
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
  updatedAt?: number;
  /** 매수 주문에 묶어둔 금액 (해당 통화) */
  holdAmount?: number;
  /** 이 시각까지 체결 안 되면 자동 취소 (당일 주문) */
  expiresAt?: number;
  /** 거부·취소 사유 */
  reason?: string;
}

export interface Fill {
  id?: number;
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
  /** 매도 실현손익 (수수료·세금 차감 후, 해당 통화) */
  realizedPnl?: number;
  /** 체결 시점의 당일 등락률 (전일 대비, 0.05 = +5%) */
  dayChangeRate?: number;
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

export interface FxTrade {
  id: number;
  from: Currency;
  to: Currency;
  rate: number;
  pay: number;
  receive: number;
  executedAt: number;
}

/** 내 계좌 (평가는 화면에서 실시간 시세로 계산) */
export interface AccountView {
  season: number;
  seedKrw: number;
  createdAt: number;
  cash: Cash;
  /** 주문가능금액 = 예수금 - 미체결 매수에 묶인 돈 */
  available: Cash;
  positions: Position[];
  /** 종목별 판매 가능 수량 (미체결 매도 제외) */
  sellable: Record<string, number>;
  /** 이번 시즌 실현손익 (통화별) */
  realizedPnl: Cash;
  openOrders: number;
  /** 오늘(한국시간 오전 7시 기준) 시작 총자산 → '오늘 수익' 계산용 */
  dayBase?: { day: string; totalKrw: number };
  /** 달러를 평균 얼마에 샀는지 (원/달러) → 환율 변동 손익 계산용 */
  avgUsdRate?: number;
}

/** 가격 알림 조건: 이상·이하는 가격, 상승·하락은 전일 대비 % */
export type AlertKind = 'above' | 'below' | 'rise' | 'fall';

export interface PriceAlert {
  id: number;
  code: string;
  kind: AlertKind;
  value: number;
  active: boolean;
  createdAt: number;
  triggeredAt?: number;
  triggeredPrice?: number;
}

/** 관심종목 그룹 (codes 순서 = 화면 순서) */
export interface WatchGroup {
  id: number;
  name: string;
  codes: string[];
}

/** 매매일지 메모 (주문 하나에 하나) */
export interface JournalNote {
  text: string;
  tags: string[];
  updatedAt?: number;
}

/** 일지 한 줄 = 체결된 주문 + 체결 내역 + 메모 */
export interface JournalEntry {
  order: Order;
  fills: Fill[];
  note?: JournalNote;
}

export interface SeasonSummary {
  season: number;
  seedKrw: number;
  startedAt: number;
  endedAt?: number;
  /** 끝난 시즌의 최종 총자산 (원화 환산) */
  finalKrw?: number;
  trades: number;
}

export type AccountEvent =
  /** background: 주문 직후가 아니라 나중에(대기·예약 주문) 체결됨 */
  | { event: 'fill'; fill: Fill; stock?: StockInfo; background?: boolean }
  | { event: 'order'; order: Order; stock?: StockInfo }
  | { event: 'fx'; trade: FxTrade }
  | { event: 'reset'; season: number };

/** 서버 → 웹 WebSocket 메시지 */
export type ServerMessage =
  | { type: 'quote'; quote: Quote }
  | { type: 'indices'; indices: IndexQuote[] }
  | ({ type: 'account' } & AccountEvent)
  | { type: 'alert'; alert: PriceAlert; stock?: StockInfo };

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
