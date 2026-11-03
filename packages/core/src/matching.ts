import type { Fill, Market, Order, Quote } from '@stock/shared';
import { currencyOf } from '@stock/shared';
import type { TradingConfig } from './config';
import { DEFAULT_CONFIG } from './config';
import { calcCosts } from './fees';
import { roundMoney } from './money';
import { priceLimits, roundToTick } from './tick';

/**
 * 시장가 체결 가격.
 * 호가가 있으면 매수=매도1호가, 매도=매수1호가.
 * 없으면 현재가에 슬리피지를 불리하게 적용하고 호가단위로 맞춤.
 */
export function marketFillPrice(
  market: Market,
  side: Order['side'],
  quote: Quote,
  config: TradingConfig = DEFAULT_CONFIG,
): number {
  if (side === 'buy' && quote.ask) return quote.ask;
  if (side === 'sell' && quote.bid) return quote.bid;

  const raw = quote.price * (side === 'buy' ? 1 + config.slippageRate : 1 - config.slippageRate);
  let price = roundToTick(market, raw, side === 'buy' ? 'up' : 'down');

  const limits = priceLimits(market, quote.prevClose, config.krPriceLimitRate);
  if (limits) price = Math.min(limits.upper, Math.max(limits.lower, price));
  return price;
}

/**
 * - taker: 주문이 시장에 막 들어온 순간 (주문 직후, 예약주문의 장 시작).
 *          지정가가 이미 유리하면 현재 시장 가격으로 체결.
 * - resting: 대기 중인 지정가 주문. 가격이 닿으면 지정가로 체결.
 */
export type FillMode = 'taker' | 'resting';

export interface TryFillInput {
  order: Order;
  quote: Quote;
  marketOpen: boolean;
  mode: FillMode;
  now?: number;
  config?: TradingConfig;
}

/** 체결 조건을 만족하면 Fill, 아니면 null (전량 체결만, 부분 체결 없음) */
export function tryFill({ order, quote, marketOpen, mode, now = Date.now(), config = DEFAULT_CONFIG }: TryFillInput): Fill | null {
  if (!marketOpen) return null;
  if (order.status !== 'pending' && order.status !== 'reserved') return null;

  const market = order.market;
  const takerPrice = marketFillPrice(market, order.side, quote, config);
  let price: number;

  if (order.type === 'market') {
    price = takerPrice;
  } else {
    const limit = order.limitPrice;
    if (limit === undefined) return null;
    if (order.side === 'buy') {
      if (takerPrice > limit && quote.price > limit) return null;
      price = mode === 'taker' ? Math.min(limit, takerPrice) : limit;
    } else {
      if (takerPrice < limit && quote.price < limit) return null;
      price = mode === 'taker' ? Math.max(limit, takerPrice) : limit;
    }
  }

  const currency = currencyOf(market);
  const amount = roundMoney(price * order.qty, currency, 'round');
  const { commission, tax } = calcCosts(market, order.side, amount, config);

  return {
    orderId: order.id,
    code: order.code,
    side: order.side,
    price,
    qty: order.qty,
    amount,
    commission,
    tax,
    currency,
    executedAt: now,
  };
}
