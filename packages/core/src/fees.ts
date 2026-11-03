import type { Market, OrderSide } from '@stock/shared';
import { currencyOf } from '@stock/shared';
import type { TradingConfig } from './config';
import { DEFAULT_CONFIG } from './config';
import { roundMoney } from './money';

export interface TradeCosts {
  commission: number;
  tax: number;
}

/** 체결금액(amount)에 대한 수수료·세금. 원화는 원 미만 절사, 달러는 센트 반올림 */
export function calcCosts(
  market: Market,
  side: OrderSide,
  amount: number,
  config: TradingConfig = DEFAULT_CONFIG,
): TradeCosts {
  const ccy = currencyOf(market);
  if (market === 'KR') {
    return {
      commission: roundMoney(amount * config.krCommissionRate, ccy, 'floor'),
      tax: side === 'sell' ? roundMoney(amount * config.krSellTaxRate, ccy, 'floor') : 0,
    };
  }
  return {
    commission: roundMoney(amount * config.usCommissionRate, ccy, 'round'),
    tax: side === 'sell' ? roundMoney(amount * config.usSellFeeRate, ccy, 'round') : 0,
  };
}
