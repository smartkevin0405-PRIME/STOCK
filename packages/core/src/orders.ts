import type { Cash, OrderSide, OrderType, Position, Quote, StockInfo } from '@stock/shared';
import type { TradingConfig } from './config';
import { DEFAULT_CONFIG } from './config';
import { calcCosts } from './fees';
import { marketFillPrice } from './matching';
import { roundMoney } from './money';
import { isValidTick, priceLimits, tickSize } from './tick';

export interface OrderRequest {
  stock: StockInfo;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
}

export interface OrderContext {
  quote: Quote;
  cash: Cash;
  position?: Position;
  /** 이미 걸어둔 매도 주문 수량 (중복 매도 방지) */
  pendingSellQty?: number;
  /** 이미 걸어둔 매수 주문에 묶인 금액 (해당 통화) */
  pendingBuyAmount?: number;
  config?: TradingConfig;
}

export interface OrderEstimate {
  price: number;
  amount: number;
  commission: number;
  tax: number;
  /** 매수: 빠져나갈 돈, 매도: 들어올 돈 */
  total: number;
  currency: StockInfo['currency'];
}

export type OrderRejectCode =
  | 'INVALID_QTY'
  | 'INVALID_PRICE'
  | 'INVALID_TICK'
  | 'PRICE_LIMIT'
  | 'INSUFFICIENT_CASH'
  | 'INSUFFICIENT_QTY';

export type OrderValidation =
  | { ok: true; estimate: OrderEstimate }
  | { ok: false; code: OrderRejectCode; message: string; estimate?: OrderEstimate };

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

/** 주문 전 확인: 수량·호가단위·가격제한폭·잔고 검사 + 예상 금액 계산 */
export function validateOrder(req: OrderRequest, ctx: OrderContext): OrderValidation {
  const config = ctx.config ?? DEFAULT_CONFIG;
  const { stock, side, type, qty } = req;
  const market = stock.market;

  if (!Number.isInteger(qty) || qty <= 0) {
    return { ok: false, code: 'INVALID_QTY', message: '수량은 1주 이상 정수로 입력해주세요' };
  }

  let price: number;
  if (type === 'limit') {
    const limit = req.limitPrice;
    if (limit === undefined || !(limit > 0)) {
      return { ok: false, code: 'INVALID_PRICE', message: '주문 가격을 입력해주세요' };
    }
    if (!isValidTick(market, limit)) {
      return {
        ok: false,
        code: 'INVALID_TICK',
        message: `호가단위에 맞지 않는 가격이에요 (이 가격대 호가단위: ${fmt(tickSize(market, limit))})`,
      };
    }
    const limits = priceLimits(market, ctx.quote.prevClose, config.krPriceLimitRate);
    if (limits && (limit > limits.upper || limit < limits.lower)) {
      return {
        ok: false,
        code: 'PRICE_LIMIT',
        message: `가격제한폭을 벗어났어요 (상한가 ${fmt(limits.upper)} / 하한가 ${fmt(limits.lower)})`,
      };
    }
    price = limit;
  } else {
    price = marketFillPrice(market, side, ctx.quote, config);
  }

  const currency = stock.currency;
  const amount = roundMoney(price * qty, currency, 'round');
  const { commission, tax } = calcCosts(market, side, amount, config);
  const total = side === 'buy' ? roundMoney(amount + commission, currency, 'round') : roundMoney(amount - commission - tax, currency, 'round');
  const estimate: OrderEstimate = { price, amount, commission, tax, total, currency };

  if (side === 'buy') {
    const available = ctx.cash[currency] - (ctx.pendingBuyAmount ?? 0);
    if (total > available + 1e-9) {
      return {
        ok: false,
        code: 'INSUFFICIENT_CASH',
        message: currency === 'USD' ? '달러가 부족해요. 먼저 환전해주세요' : '주문가능금액이 부족해요',
        estimate,
      };
    }
  } else {
    const sellable = (ctx.position?.qty ?? 0) - (ctx.pendingSellQty ?? 0);
    if (qty > sellable) {
      return { ok: false, code: 'INSUFFICIENT_QTY', message: `매도 가능 수량이 부족해요 (가능: ${Math.max(0, sellable)}주)`, estimate };
    }
  }

  return { ok: true, estimate };
}
