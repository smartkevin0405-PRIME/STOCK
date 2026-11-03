import type { Cash, Fill, Position, Quote } from '@stock/shared';
import { roundMoney } from './money';

export interface AccountState {
  cash: Cash;
  positions: Record<string, Position>;
}

export interface ApplyFillResult extends AccountState {
  /** 매도 시 실현손익 (수수료·세금 차감 후) */
  realizedPnl: number;
}

/** 체결 결과를 계좌에 반영 (원본은 건드리지 않고 새 객체 반환) */
export function applyFill(state: AccountState, fill: Fill): ApplyFillResult {
  const ccy = fill.currency;
  const cash: Cash = { ...state.cash };
  const positions = { ...state.positions };
  const prev = positions[fill.code];

  if (fill.side === 'buy') {
    cash[ccy] = roundMoney(cash[ccy] - fill.amount - fill.commission, ccy, 'round');
    const oldQty = prev?.qty ?? 0;
    const oldCost = oldQty * (prev?.avgPrice ?? 0);
    const qty = oldQty + fill.qty;
    positions[fill.code] = { code: fill.code, qty, avgPrice: (oldCost + fill.amount) / qty, currency: ccy };
    return { cash, positions, realizedPnl: 0 };
  }

  if (!prev || prev.qty < fill.qty) {
    throw new Error(`보유 수량보다 많이 팔 수 없어요: ${fill.code}`);
  }
  cash[ccy] = roundMoney(cash[ccy] + fill.amount - fill.commission - fill.tax, ccy, 'round');
  const realizedPnl = roundMoney(
    fill.amount - prev.avgPrice * fill.qty - fill.commission - fill.tax,
    ccy,
    'round',
  );
  const qty = prev.qty - fill.qty;
  if (qty === 0) delete positions[fill.code];
  else positions[fill.code] = { ...prev, qty };
  return { cash, positions, realizedPnl };
}

export interface HoldingValuation {
  code: string;
  qty: number;
  avgPrice: number;
  price: number;
  currency: Position['currency'];
  /** 평가금액 (해당 통화) */
  value: number;
  /** 매입금액 (해당 통화) */
  cost: number;
  pnl: number;
  pnlRate: number;
}

export interface PortfolioValuation {
  holdings: HoldingValuation[];
  /** 총자산 (원화 환산) */
  totalKrw: number;
  /** 주식 평가금액 합계 (원화 환산) */
  stockValueKrw: number;
  /** 평가손익 합계 (원화 환산) */
  pnlKrw: number;
}

/** 현재가 기준 평가. 시세가 없는 종목은 평균단가로 평가 */
export function evaluatePortfolio(
  state: AccountState,
  quotes: Record<string, Quote | undefined>,
  usdKrw: number,
): PortfolioValuation {
  const toKrw = (v: number, ccy: Position['currency']) => (ccy === 'USD' ? v * usdKrw : v);
  const holdings = Object.values(state.positions).map((p): HoldingValuation => {
    const price = quotes[p.code]?.price ?? p.avgPrice;
    const value = price * p.qty;
    const cost = p.avgPrice * p.qty;
    return {
      code: p.code,
      qty: p.qty,
      avgPrice: p.avgPrice,
      price,
      currency: p.currency,
      value,
      cost,
      pnl: value - cost,
      pnlRate: cost > 0 ? (value - cost) / cost : 0,
    };
  });
  const stockValueKrw = holdings.reduce((s, h) => s + toKrw(h.value, h.currency), 0);
  const pnlKrw = holdings.reduce((s, h) => s + toKrw(h.pnl, h.currency), 0);
  return {
    holdings,
    stockValueKrw: Math.round(stockValueKrw),
    pnlKrw: Math.round(pnlKrw),
    totalKrw: Math.round(state.cash.KRW + state.cash.USD * usdKrw + stockValueKrw),
  };
}
