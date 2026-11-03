import type { Currency, Market, StockInfo } from './index';

// 타임머신 리플레이 (과거 일봉으로 연습, 본 계좌와 분리)

export interface ReplayScenario {
  id: string;
  title: string;
  description: string;
  market: Market;
  currency: Currency;
  /** 'YYYY-MM-DD' (거래 시작일, 포함) */
  start: string;
  /** 'YYYY-MM-DD' (마지막 날, 포함) */
  end: string;
  /** 시작 금액 (해당 통화) */
  startCash: number;
  /** 기본 종목 */
  codes: string[];
  /** 시작 전에 미리 보여줄 일봉 수 */
  lookbackDays: number;
}

export interface ReplayResult {
  id: number;
  scenarioId: string;
  codes: string[];
  startCash: number;
  finalValue: number;
  /** 0.12 = +12% */
  returnRate: number;
  tradeCount: number;
  /** epoch ms */
  finishedAt: number;
}

export interface ReplayScenariosResponse {
  scenarios: ReplayScenario[];
  stocks: Record<string, StockInfo>;
}
