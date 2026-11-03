import type { Candle, Currency, Fill, Market, OrderSide, Position } from '@stock/shared';
import { currencyOf } from '@stock/shared';
import type { TradingConfig } from './config';
import { DEFAULT_CONFIG } from './config';
import { calcCosts } from './fees';
import { roundMoney } from './money';
import { applyFill } from './portfolio';
import { roundToTick } from './tick';

// 타임머신 리플레이: 과거 일봉을 하루씩 넘기며 연습하는 전용 계좌.
// 주문은 그날 종가에 슬리피지를 불리하게 붙여 바로 체결 (가격제한폭은 따지지 않음).
// 미래 데이터가 새지 않게, 가격은 항상 "지금 날짜까지 나온 봉"에서만 꺼냄.

export interface ReplayTrade {
  /** 체결한 날 (일봉 time, epoch 초) */
  time: number;
  code: string;
  side: OrderSide;
  qty: number;
  price: number;
  amount: number;
  commission: number;
  tax: number;
  /** 매도 실현손익 (수수료·세금 차감 후) */
  realizedPnl: number;
}

export interface ReplayAccount {
  market: Market;
  currency: Currency;
  startCash: number;
  cash: number;
  positions: Record<string, Position>;
  trades: ReplayTrade[];
}

export function createReplayAccount(market: Market, startCash: number): ReplayAccount {
  return { market, currency: currencyOf(market), startCash, cash: startCash, positions: {}, trades: [] };
}

/** 'YYYY-MM-DD' → 그날 일봉 time (UTC 자정, epoch 초) */
export function replayDayTime(date: string): number {
  return Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 1000;
}

/** time 이하인 봉만 (candles는 시간순 정렬) */
export function visibleCandles(candles: Candle[], time: number): Candle[] {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid]!.time <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo === candles.length ? candles : candles.slice(0, lo);
}

/** 그날까지 나온 마지막 종가 (아직 봉이 없으면 undefined) */
export function closeAt(candles: Candle[], time: number): number | undefined {
  const v = visibleCandles(candles, time);
  return v[v.length - 1]?.close;
}

/** 시작 전 봉은 lookback개만 남기고, 시작~끝 봉은 전부 */
export function trimReplayCandles(candles: Candle[], start: number, end: number, lookback: number): Candle[] {
  const before = candles.filter((c) => c.time < start).slice(-lookback);
  return [...before, ...candles.filter((c) => c.time >= start && c.time <= end)];
}

/** 재생할 날짜들: 종목들 일봉 날짜를 합쳐서 정렬 (start~end) */
export function replayTimeline(histories: Candle[][], start: number, end: number): number[] {
  const days = new Set<number>();
  for (const cs of histories) for (const c of cs) if (c.time >= start && c.time <= end) days.add(c.time);
  return [...days].sort((a, b) => a - b);
}

/** 종가 기준 체결가: 매수는 비싸게, 매도는 싸게 (슬리피지 + 호가단위) */
export function replayFillPrice(market: Market, side: OrderSide, close: number, config: TradingConfig = DEFAULT_CONFIG): number {
  const raw = close * (side === 'buy' ? 1 + config.slippageRate : 1 - config.slippageRate);
  return roundToTick(market, raw, side === 'buy' ? 'up' : 'down');
}

export interface ReplayOrderInput {
  code: string;
  side: OrderSide;
  qty: number;
  /** 그 종목 일봉 전체 (미래 봉이 섞여 있어도 time 이후는 안 씀) */
  candles: Candle[];
  /** 지금 날짜 (epoch 초) */
  time: number;
}

export interface ReplayEstimate {
  price: number;
  amount: number;
  commission: number;
  tax: number;
  /** 매수: 필요한 돈, 매도: 받을 돈 */
  total: number;
}

export type ReplayOrderResult =
  | { ok: true; account: ReplayAccount; trade: ReplayTrade }
  | { ok: false; message: string; estimate?: ReplayEstimate };

/** 주문 미리 계산 (계좌는 안 바뀜) */
export function estimateReplayOrder(
  market: Market,
  side: OrderSide,
  qty: number,
  close: number,
  config: TradingConfig = DEFAULT_CONFIG,
): ReplayEstimate {
  const ccy = currencyOf(market);
  const price = replayFillPrice(market, side, close, config);
  const amount = roundMoney(price * qty, ccy, 'round');
  const { commission, tax } = calcCosts(market, side, amount, config);
  const total = side === 'buy' ? roundMoney(amount + commission, ccy, 'round') : roundMoney(amount - commission - tax, ccy, 'round');
  return { price, amount, commission, tax, total };
}

/** 시장가 주문 → 그날 종가로 바로 체결. 원본 계좌는 그대로 두고 새 계좌 반환 */
export function replayOrder(account: ReplayAccount, input: ReplayOrderInput, config: TradingConfig = DEFAULT_CONFIG): ReplayOrderResult {
  const { code, side, qty, candles, time } = input;
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, message: '수량을 1주 이상으로 정해주세요' };
  const close = closeAt(candles, time);
  if (close === undefined) return { ok: false, message: '아직 거래할 수 없는 종목이에요' };

  const estimate = estimateReplayOrder(account.market, side, qty, close, config);
  const held = account.positions[code]?.qty ?? 0;
  if (side === 'buy' && estimate.total > account.cash + 1e-9) return { ok: false, message: '돈이 부족해요', estimate };
  if (side === 'sell' && qty > held) return { ok: false, message: `판매 가능 수량은 ${held}주예요`, estimate };

  const fill: Fill = {
    orderId: `replay-${account.trades.length + 1}`,
    code,
    side,
    price: estimate.price,
    qty,
    amount: estimate.amount,
    commission: estimate.commission,
    tax: estimate.tax,
    currency: account.currency,
    executedAt: time * 1000,
  };
  const empty = { KRW: 0, USD: 0 };
  const next = applyFill({ cash: { ...empty, [account.currency]: account.cash }, positions: account.positions }, fill);
  const trade: ReplayTrade = {
    time,
    code,
    side,
    qty,
    price: fill.price,
    amount: fill.amount,
    commission: fill.commission,
    tax: fill.tax,
    realizedPnl: next.realizedPnl,
  };
  return {
    ok: true,
    trade,
    account: { ...account, cash: next.cash[account.currency], positions: next.positions, trades: [...account.trades, trade] },
  };
}

/** 지금 현금으로 살 수 있는 최대 수량 (수수료 포함) */
export function maxReplayBuyQty(account: ReplayAccount, close: number, config: TradingConfig = DEFAULT_CONFIG): number {
  const price = replayFillPrice(account.market, 'buy', close, config);
  if (!(price > 0)) return 0;
  const rate = account.market === 'KR' ? config.krCommissionRate : config.usCommissionRate;
  let qty = Math.floor(account.cash / (price * (1 + rate)));
  while (qty > 0 && estimateReplayOrder(account.market, 'buy', qty, close, config).total > account.cash) qty--;
  while (estimateReplayOrder(account.market, 'buy', qty + 1, close, config).total <= account.cash) qty++;
  return qty;
}

export interface ReplayValuation {
  /** 주식 평가금액 */
  stockValue: number;
  /** 현금 + 주식 */
  total: number;
  /** 시작 금액 대비 수익률 */
  returnRate: number;
}

/** 그날 종가로 평가. 종가가 없는 종목은 평균단가로 */
export function valueReplayAccount(account: ReplayAccount, histories: Record<string, Candle[]>, time: number): ReplayValuation {
  let stockValue = 0;
  for (const p of Object.values(account.positions)) {
    const price = closeAt(histories[p.code] ?? [], time) ?? p.avgPrice;
    stockValue += price * p.qty;
  }
  stockValue = roundMoney(stockValue, account.currency, 'round');
  const total = roundMoney(account.cash + stockValue, account.currency, 'round');
  return { stockValue, total, returnRate: account.startCash > 0 ? (total - account.startCash) / account.startCash : 0 };
}

// ── 진행 저장 (화면을 나갔다 와도 이어하기) ──

export interface ReplayProgress {
  v: 1;
  scenarioId: string;
  /** 지금 날짜 (일봉 time, epoch 초) */
  time: number;
  code: string;
  account: ReplayAccount;
  savedAt: number;
}

export function makeReplayProgress(scenarioId: string, time: number, code: string, account: ReplayAccount, savedAt: number): ReplayProgress {
  return { v: 1, scenarioId, time, code, account, savedAt };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * 저장된 진행을 검사해서 되살림. 형식이 다르거나, 다른 시나리오거나, 날짜가 없으면 null.
 * days: 이번에 불러온 재생 날짜들 → 저장된 날짜(또는 그 직전 날) 위치로 맞춤
 */
export function restoreReplayProgress(
  raw: unknown,
  scenarioId: string,
  days: readonly number[],
  codes: readonly string[],
): { dayIdx: number; code: string; account: ReplayAccount } | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<ReplayProgress>;
  if (p.v !== 1 || p.scenarioId !== scenarioId || !isNum(p.time) || typeof p.code !== 'string') return null;
  const a = p.account as Partial<ReplayAccount> | undefined;
  if (!a || !isNum(a.cash) || !isNum(a.startCash) || !a.positions || typeof a.positions !== 'object' || !Array.isArray(a.trades)) return null;
  for (const pos of Object.values(a.positions)) {
    if (!pos || !isNum(pos.qty) || !isNum(pos.avgPrice) || pos.qty <= 0) return null;
  }
  // 저장된 날 이하 중 가장 늦은 날
  let dayIdx = -1;
  for (let i = 0; i < days.length; i++) if (days[i]! <= p.time) dayIdx = i;
  if (dayIdx < 0) return null;
  return { dayIdx, code: codes.includes(p.code) ? p.code : (codes[0] ?? p.code), account: a as ReplayAccount };
}
