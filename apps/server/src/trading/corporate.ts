import { roundMoney } from '@stock/core';
import type { Fill, StockInfo } from '@stock/shared';
import { fetchJson } from '../market/http';
import type { MarketDataProvider } from '../market/provider';
import { yahooSymbol } from '../market/yahoo';
import { transaction } from './schema';
import type { TradingService } from './service';

/** 배당·액면분할 (date = 배당락일·분할 기준일, epoch ms) */
export interface CorporateEvents {
  dividends: { date: number; amount: number }[];
  /** ratio = 1주가 몇 주가 되는지 (4:1 분할이면 4) */
  splits: { date: number; ratio: number }[];
}

export type CorporateFetcher = (stock: StockInfo, from: number, to: number) => Promise<CorporateEvents>;

/** 배당소득세 (원천징수): 국내 15.4%, 미국 15% */
const DIVIDEND_TAX = { KRW: 0.154, USD: 0.15 } as const;

/** 야후 차트의 events (배당·분할) */
export const fetchYahooEvents: CorporateFetcher = async (stock, from, to) => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(stock))}?interval=1d&period1=${Math.floor(from / 1000)}&period2=${Math.floor(to / 1000)}&events=div,splits`;
  const res = await fetchJson<{
    chart?: { result?: { events?: { dividends?: Record<string, { amount: number; date: number }>; splits?: Record<string, { numerator: number; denominator: number; date: number }> } }[] };
  }>(url, 15_000);
  const ev = res.chart?.result?.[0]?.events ?? {};
  return {
    dividends: Object.values(ev.dividends ?? {}).map((d) => ({ date: d.date * 1000, amount: d.amount })),
    splits: Object.values(ev.splits ?? {})
      .filter((s) => s.numerator > 0 && s.denominator > 0)
      .map((s) => ({ date: s.date * 1000, ratio: s.numerator / s.denominator })),
  };
};

/**
 * 분할 전 체결을 분할 후 기준으로 환산 (수량 × 비율, 가격 ÷ 비율).
 * 이렇게 해야 분할 뒤에 판 수량이 산 수량보다 많아 보이지 않음 (통계·코치용)
 */
export function adjustForSplits<T extends Fill>(fills: readonly T[], splits: readonly { code: string; date: number; value: number }[]): T[] {
  if (splits.length === 0) return [...fills];
  return fills.map((f) => {
    const ratio = splits.filter((s) => s.code === f.code && f.executedAt < s.date).reduce((r, s) => r * s.value, 1);
    return ratio === 1 ? f : { ...f, qty: f.qty * ratio, price: f.price / ratio };
  });
}

export interface AppliedAction {
  code: string;
  kind: 'dividend' | 'split';
  date: number;
  /** 배당: 입금액 (세후), 분할: 비율 */
  value: number;
  /** 배당: 대상 수량, 분할: 분할 후 수량 */
  qty: number;
}

/**
 * 보유 종목의 배당·액면분할을 계좌에 반영 (하루 한 번).
 * - 배당: 배당락일 전날까지 가지고 있던 수량 × 주당 배당금 - 세금 → 현금
 * - 분할: 수량 × 비율, 평균단가 ÷ 비율. 1주 미만 자투리는 지금 가격으로 현금 정산. 미체결 주문은 취소
 */
export class CorporateActions {
  constructor(
    private readonly trading: TradingService,
    private readonly provider: MarketDataProvider,
    private readonly fetchEvents: CorporateFetcher,
    private readonly now: () => number = Date.now,
  ) {}

  async run(): Promise<AppliedAction[]> {
    const acc = this.trading.account();
    const repo = this.trading.repo;
    const fills = repo.allFills(acc.id);
    // 이번 시즌에 한 번이라도 가졌던 종목 (최근에 판 종목도 배당은 받을 수 있음)
    const codes = [...new Set(fills.map((f) => f.code))];
    const applied: AppliedAction[] = [];
    const to = this.now();
    const from = Math.max(acc.createdAt, to - 30 * 86_400_000);

    for (const code of codes) {
      const stock = await this.provider.getStock(code);
      if (!stock) continue;
      let events: CorporateEvents;
      try {
        events = await this.fetchEvents(stock, from, to);
      } catch {
        continue;
      }
      // 분할 먼저 (같은 날 배당이 있으면 분할 후 기준 아님 — 배당은 배당락 전 수량으로 계산하므로 순서 무관)
      for (const s of events.splits.filter((e) => e.date > acc.createdAt && e.date <= to)) {
        if (repo.hasCorporateAction(acc.id, code, 'split', s.date)) continue;
        const done = this.applySplit(acc.id, stock, s.date, s.ratio);
        if (done) applied.push(done);
      }
      for (const d of events.dividends.filter((e) => e.date > acc.createdAt && e.date <= to)) {
        if (repo.hasCorporateAction(acc.id, code, 'dividend', d.date)) continue;
        const done = this.applyDividend(acc.id, stock, d.date, d.amount);
        if (done) applied.push(done);
      }
    }
    if (applied.length) this.trading.notifyCorporate(applied);
    return applied;
  }

  /** 배당락일 전에 체결된 거래로 그 시점 보유 수량 계산 (분할 반영) */
  private qtyBefore(accountId: number, code: string, date: number): number {
    const repo = this.trading.repo;
    const splits = repo.corporateActions(accountId).filter((a) => a.kind === 'split' && a.date < date);
    return adjustForSplits(repo.allFills(accountId), splits)
      .filter((f) => f.code === code && f.executedAt < date)
      .reduce((q, f) => q + (f.side === 'buy' ? f.qty : -f.qty), 0);
  }

  private applyDividend(accountId: number, stock: StockInfo, date: number, amount: number): AppliedAction | null {
    const repo = this.trading.repo;
    const qty = this.qtyBefore(accountId, stock.code, date);
    const ccy = stock.currency;
    const net = roundMoney(qty * amount * (1 - DIVIDEND_TAX[ccy]), ccy, 'floor');
    return transaction(repo.db, () => {
      repo.recordCorporateAction(accountId, stock.code, 'dividend', date, amount, this.now());
      if (qty <= 0 || net <= 0) return null;
      const acc = repo.account(accountId)!;
      repo.setCash(accountId, { ...acc.cash, [ccy]: roundMoney(acc.cash[ccy] + net, ccy, 'round') });
      return { code: stock.code, kind: 'dividend' as const, date, value: net, qty };
    });
  }

  private applySplit(accountId: number, stock: StockInfo, date: number, ratio: number): AppliedAction | null {
    const repo = this.trading.repo;
    return transaction(repo.db, () => {
      repo.recordCorporateAction(accountId, stock.code, 'split', date, ratio, this.now());
      const pos = repo.positions(accountId)[stock.code];
      if (!pos || ratio === 1) return null;
      for (const o of repo.openOrders(accountId)) {
        if (o.code === stock.code) repo.updateOrder(o.id, { status: 'cancelled', reason: '액면분할로 미체결 주문이 취소됐어요' }, this.now());
      }
      const exact = pos.qty * ratio;
      const qty = Math.floor(exact + 1e-9);
      const avgPrice = pos.avgPrice / ratio;
      // 1주 미만 자투리는 평균단가로 현금 정산 (손익 없이)
      const leftover = exact - qty;
      if (leftover > 1e-9) {
        const acc = repo.account(accountId)!;
        const ccy = stock.currency;
        repo.setCash(accountId, { ...acc.cash, [ccy]: roundMoney(acc.cash[ccy] + leftover * avgPrice, ccy, 'floor') });
      }
      repo.setPosition(accountId, stock.code, qty > 0 ? { ...pos, qty, avgPrice } : undefined);
      return { code: stock.code, kind: 'split' as const, date, value: ratio, qty };
    });
  }
}
