import {
  buildClosedTrades,
  calcMaxDrawdown,
  calcTradeStats,
  runCoach,
  type CoachFill,
  type CoachReport,
  type DrawdownResult,
  type TradeStats,
} from '@stock/core';
import type { Candle } from '@stock/shared';
import type { MarketDataProvider } from '../market/provider';
import { adjustForSplits } from './corporate';
import type { TradingService } from './service';

export type StatsPeriod = 'all' | 'month' | 'week';

export interface TaxEstimate {
  year: number;
  /** 올해 미국주식 실현손익 (원화 환산, 지금 환율로 대략) */
  usRealizedKrw: number;
  /** 기본공제 250만원 */
  deductionKrw: number;
  taxableKrw: number;
  /** 22% (양도세 20% + 지방세 2%) */
  estimatedTaxKrw: number;
}

export interface StatsView {
  period: StatsPeriod;
  /** 기간 시작 (epoch ms). 전체면 없음 */
  from?: number;
  trades: TradeStats;
  /** 이번 시즌 하루 시작 자산 기록 + 맨 끝은 지금(day = 'now'). 오래된 것부터 */
  equity: { day: string; totalKrw: number }[];
  drawdown: DrawdownResult | null;
  /** 하루 손익 = 다음 날 시작 자산 - 그날 시작 자산 (오늘은 지금 - 오늘 시작) */
  calendar: { day: string; pnlKrw: number }[];
  tax: TaxEstimate;
  usdKrw: number;
}

export interface CoachView {
  report: CoachReport;
  /** 자산 대비 가장 큰 종목 비중 */
  concentration: { code: string; weight: number; triggered: boolean } | null;
  stopLossRate?: number;
}

const KST = 9 * 3_600_000;
const US_DEDUCTION = 2_500_000;
const US_TAX_RATE = 0.22;

/** 한국시간 기준 이번 주 월요일 0시 / 이번 달 1일 0시 (epoch ms) */
export function periodStart(period: StatsPeriod, now: number): number | undefined {
  if (period === 'all') return undefined;
  const d = new Date(now + KST);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (period === 'month') return Date.UTC(y, m, 1) - KST;
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  return Date.UTC(y, m, d.getUTCDate() - dow) - KST;
}

/** 통계·자산 추이·수익 캘린더·코치 */
export class StatsService {
  constructor(
    private readonly trading: TradingService,
    private readonly provider: MarketDataProvider,
    private readonly now: () => number = Date.now,
  ) {}

  /** 시즌 체결 (액면분할 반영해서 수량·가격 환산) */
  private fillsOf(accountId: number) {
    const splits = this.trading.repo.corporateActions(accountId).filter((a) => a.kind === 'split');
    return adjustForSplits(this.trading.repo.allFills(accountId), splits);
  }

  async stats(period: StatsPeriod): Promise<StatsView> {
    const acc = this.trading.account();
    const fills = this.fillsOf(acc.id);
    const [current, usdKrw] = await Promise.all([this.trading.currentValue(), this.provider.getUsdKrw().catch(() => 1_400)]);

    const from = periodStart(period, this.now());
    const closed = buildClosedTrades(fills).filter((t) => from === undefined || t.closedAt >= from);
    const trades = calcTradeStats(closed, { usdKrw });

    // 자산 추이: 하루 시작 기록들 + 맨 끝에 지금 (day = 'now')
    const snaps = this.trading.snapshots();
    const equity = [...snaps.map((s) => ({ day: s.day, totalKrw: s.totalKrw })), { day: 'now', totalKrw: current.totalKrw }];

    const points = equity.map((e, i) => ({ time: i, value: e.totalKrw }));
    const drawdown = calcMaxDrawdown(points);

    const calendar = snaps.map((s, i) => {
      const next = snaps[i + 1]?.totalKrw ?? current.totalKrw;
      return { day: s.day, pnlKrw: Math.round(next - s.totalKrw) };
    });

    // 미국주식 양도세 예상 (올해, 한국시간 기준)
    const year = new Date(this.now() + KST).getUTCFullYear();
    const yearStart = Date.UTC(year, 0, 1) - KST;
    const usRealizedKrw = Math.round(
      fills.filter((f) => f.currency === 'USD' && f.side === 'sell' && f.executedAt >= yearStart).reduce((s, f) => s + (f.realizedPnl ?? 0), 0) * usdKrw,
    );
    const taxableKrw = Math.max(0, usRealizedKrw - US_DEDUCTION);

    return {
      period,
      ...(from !== undefined ? { from } : {}),
      trades,
      equity,
      drawdown,
      calendar,
      tax: { year, usRealizedKrw, deductionKrw: US_DEDUCTION, taxableKrw, estimatedTaxKrw: Math.round(taxableKrw * US_TAX_RATE) },
      usdKrw,
    };
  }

  /** 코스피·S&P500 일봉 (자산 추이 비교용) */
  async benchmarks(from: number): Promise<{ symbol: string; name: string; candles: Candle[] }[]> {
    const to = this.now();
    const list = [
      { symbol: '^KS11', name: '코스피' },
      { symbol: '^GSPC', name: 'S&P 500' },
    ];
    const results = await Promise.allSettled(list.map((b) => this.provider.getIndexHistory(b.symbol, from, to)));
    return list.flatMap((b, i) => {
      const r = results[i]!;
      return r.status === 'fulfilled' && r.value.length ? [{ ...b, candles: r.value }] : [];
    });
  }

  /** 규칙 기반 코치 + 집중도 (이번 시즌 전체 기록) */
  async coach(): Promise<CoachView> {
    const acc = this.trading.account();
    const fills = this.fillsOf(acc.id) as CoachFill[];
    const [current, usdKrw] = await Promise.all([this.trading.currentValue(), this.provider.getUsdKrw().catch(() => 1_400)]);
    const stopLoss = this.trading.repo.getSetting('stopLossRate');
    const stopLossRate = stopLoss !== undefined ? Number(stopLoss) : undefined;
    const report = runCoach(fills, { usdKrw, ...(stopLossRate !== undefined ? { stopLossRate } : {}) });

    const top = [...current.holdings]
      .map((h) => ({ code: h.code, value: h.value * (h.currency === 'USD' ? usdKrw : 1) }))
      .sort((a, b) => b.value - a.value)[0];
    const concentration =
      top && current.totalKrw > 0 ? { code: top.code, weight: top.value / current.totalKrw, triggered: top.value / current.totalKrw >= 0.5 } : null;

    return { report, concentration, ...(stopLossRate !== undefined ? { stopLossRate } : {}) };
  }
}
