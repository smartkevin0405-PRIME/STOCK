import type { Currency } from '@stock/shared';
import type { TradingConfig } from './config';
import { DEFAULT_CONFIG } from './config';
import { roundMoney } from './money';

export interface FxQuote {
  from: Currency;
  to: Currency;
  /** 적용 환율 (원/달러, 소수 둘째 자리) */
  rate: number;
  /** 내는 금액 (from 통화) */
  pay: number;
  /** 받는 금액 (to 통화, 절사) */
  receive: number;
}

/** 원→달러는 비싸게(기준+스프레드), 달러→원은 싸게(기준-스프레드) */
export function quoteFx(
  from: Currency,
  amount: number,
  baseRate: number,
  config: TradingConfig = DEFAULT_CONFIG,
): FxQuote {
  if (from === 'KRW') {
    const rate = roundMoney(baseRate * (1 + config.fxSpreadRate), 'USD', 'round');
    return { from, to: 'USD', rate, pay: amount, receive: roundMoney(amount / rate, 'USD', 'floor') };
  }
  const rate = roundMoney(baseRate * (1 - config.fxSpreadRate), 'USD', 'round');
  return { from, to: 'KRW', rate, pay: amount, receive: roundMoney(amount * rate, 'KRW', 'floor') };
}
