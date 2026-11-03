// 매매 통계: 승률, 평균 수익/손실, 손익비, 최대 낙폭(MDD), 보유기간 — 순수 함수
import type { Currency, Fill } from '@stock/shared';
import { roundMoney } from './money';

const DAY_MS = 86_400_000;

/** 매도 체결 1건 = 청산 거래 1건 (분할 매도면 여러 건) */
export interface ClosedTrade {
  code: string;
  currency: Currency;
  /** 매도 주문 ID */
  orderId: string;
  qty: number;
  /** 매수 평균단가 (평균단가 방식 — 계좌 평균단가와 같음) */
  entryPrice: number;
  exitPrice: number;
  /** 매입금액 = entryPrice × qty */
  cost: number;
  /**
   * 실현손익 (해당 통화). 매도 수수료·세금 + 매수 수수료(수량 비례)까지 뺀 값.
   * 계좌의 realizedPnl은 매수 수수료를 빼지 않으니 그만큼 다를 수 있음.
   */
  pnl: number;
  /** pnl / cost */
  pnlRate: number;
  /** 수수료·세금 제외 가격 등락 = exitPrice / entryPrice - 1 */
  priceRate: number;
  /** 이번에 판 주식 중 가장 먼저 산 시각 (epoch ms) */
  openedAt: number;
  closedAt: number;
  /** 보유기간 (ms) — 먼저 산 주식부터 판다고 보고(FIFO) 수량 가중 평균 */
  holdingMs: number;
}

interface Lot {
  qty: number;
  time: number;
}

interface OpenPosition {
  qty: number;
  /** 매입금액 합계 (평균단가 × 수량) */
  cost: number;
  /** 아직 청산 안 된 매수 수수료 */
  buyFee: number;
  lots: Lot[];
}

/** 체결 시각 순으로 정렬 (같은 시각이면 입력 순서 유지) */
export function sortFills<T extends Fill>(fills: readonly T[]): T[] {
  return fills
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.executedAt - b.f.executedAt || a.i - b.i)
    .map(({ f }) => f);
}

/** 체결 내역 → 청산 거래 목록. 보유 수량보다 많이 팔면 에러 */
export function buildClosedTrades(fills: readonly Fill[]): ClosedTrade[] {
  const positions = new Map<string, OpenPosition>();
  const trades: ClosedTrade[] = [];

  for (const f of sortFills(fills)) {
    let p = positions.get(f.code);
    if (!p) {
      p = { qty: 0, cost: 0, buyFee: 0, lots: [] };
      positions.set(f.code, p);
    }

    if (f.side === 'buy') {
      p.qty += f.qty;
      p.cost += f.amount;
      p.buyFee += f.commission;
      p.lots.push({ qty: f.qty, time: f.executedAt });
      continue;
    }

    if (p.qty < f.qty) throw new Error(`보유 수량보다 많이 팔 수 없어요: ${f.code}`);

    const share = f.qty / p.qty;
    const cost = p.cost * share;
    const buyFee = p.buyFee * share;
    const entryPrice = p.cost / p.qty;

    // FIFO로 보유기간 계산
    let remaining = f.qty;
    let weighted = 0;
    const openedAt = p.lots[0]!.time;
    while (remaining > 0) {
      const lot = p.lots[0]!;
      const used = Math.min(lot.qty, remaining);
      weighted += used * (f.executedAt - lot.time);
      lot.qty -= used;
      remaining -= used;
      if (lot.qty === 0) p.lots.shift();
    }

    const pnl = roundMoney(f.amount - cost - buyFee - f.commission - f.tax, f.currency, 'round');
    trades.push({
      code: f.code,
      currency: f.currency,
      orderId: f.orderId,
      qty: f.qty,
      entryPrice,
      exitPrice: f.price,
      cost,
      pnl,
      pnlRate: cost > 0 ? pnl / cost : 0,
      priceRate: entryPrice > 0 ? f.price / entryPrice - 1 : 0,
      openedAt,
      closedAt: f.executedAt,
      holdingMs: weighted / f.qty,
    });

    p.qty -= f.qty;
    if (p.qty === 0) {
      // 다 팔았으면 소수점 오차 없이 초기화
      p.cost = 0;
      p.buyFee = 0;
      p.lots = [];
    } else {
      p.cost -= cost;
      p.buyFee -= buyFee;
    }
  }
  return trades;
}

export interface HoldingStats {
  /** 단위: 일 (24시간 = 1일, 소수점 포함) */
  avgDays: number;
  medianDays: number;
  minDays: number;
  maxDays: number;
}

export interface TradeStats {
  /** 청산 거래 수 */
  count: number;
  wins: number;
  losses: number;
  /** 손익 0 */
  breakeven: number;
  /** wins / count. 거래가 없으면 null */
  winRate: number | null;
  /** 실현손익 합계 (원화 환산) */
  totalPnlKrw: number;
  /** 수익 거래 손익 합계 (원화 환산, 양수) */
  grossProfitKrw: number;
  /** 손실 거래 손익 합계 (원화 환산, 음수) */
  grossLossKrw: number;
  /** 평균 수익 (원화 환산). 수익 거래가 없으면 null */
  avgWinKrw: number | null;
  /** 평균 손실 (원화 환산, 음수). 손실 거래가 없으면 null */
  avgLossKrw: number | null;
  /** 수익 거래의 평균 수익률 */
  avgWinRate: number | null;
  /** 손실 거래의 평균 수익률 (음수) */
  avgLossRate: number | null;
  /** 손익비 = 평균 수익 ÷ |평균 손실|. 손실 거래가 없으면 null */
  payoffRatio: number | null;
  /** 총이익 ÷ |총손실|. 손실 거래가 없으면 null */
  profitFactor: number | null;
  /** 최대 연승 / 연패 (청산 시각 순) */
  maxWinStreak: number;
  maxLossStreak: number;
  /** 보유기간. 거래가 없으면 null */
  holding: HoldingStats | null;
}

export interface StatsOptions {
  /** 달러 거래를 원화로 환산할 환율. 달러 거래가 있으면 필수 */
  usdKrw?: number;
}

/** 통화별 금액 → 원화 환산 함수. 달러인데 환율이 없으면 에러 */
export function krwConverter(usdKrw?: number) {
  return (amount: number, currency: Currency): number => {
    if (currency === 'KRW') return amount;
    if (usdKrw === undefined || !(usdKrw > 0)) throw new Error('달러 거래를 원화로 환산하려면 환율(usdKrw)이 필요해요');
    return amount * usdKrw;
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function calcTradeStats(trades: readonly ClosedTrade[], options: StatsOptions = {}): TradeStats {
  const toKrw = krwConverter(options.usdKrw);
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const pnlKrw = sorted.map((t) => toKrw(t.pnl, t.currency));

  const winIdx = sorted.flatMap((t, i) => (t.pnl > 0 ? [i] : []));
  const lossIdx = sorted.flatMap((t, i) => (t.pnl < 0 ? [i] : []));

  const grossProfitKrw = winIdx.reduce((s, i) => s + pnlKrw[i]!, 0);
  const grossLossKrw = lossIdx.reduce((s, i) => s + pnlKrw[i]!, 0);
  const avgWinKrw = mean(winIdx.map((i) => pnlKrw[i]!));
  const avgLossKrw = mean(lossIdx.map((i) => pnlKrw[i]!));

  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let win = 0;
  let loss = 0;
  for (const t of sorted) {
    win = t.pnl > 0 ? win + 1 : 0;
    loss = t.pnl < 0 ? loss + 1 : 0;
    maxWinStreak = Math.max(maxWinStreak, win);
    maxLossStreak = Math.max(maxLossStreak, loss);
  }

  const days = sorted.map((t) => t.holdingMs / DAY_MS);

  return {
    count: sorted.length,
    wins: winIdx.length,
    losses: lossIdx.length,
    breakeven: sorted.length - winIdx.length - lossIdx.length,
    winRate: sorted.length ? winIdx.length / sorted.length : null,
    totalPnlKrw: Math.round(pnlKrw.reduce((s, x) => s + x, 0)),
    grossProfitKrw: Math.round(grossProfitKrw),
    grossLossKrw: Math.round(grossLossKrw),
    avgWinKrw: avgWinKrw === null ? null : Math.round(avgWinKrw),
    avgLossKrw: avgLossKrw === null ? null : Math.round(avgLossKrw),
    avgWinRate: mean(winIdx.map((i) => sorted[i]!.pnlRate)),
    avgLossRate: mean(lossIdx.map((i) => sorted[i]!.pnlRate)),
    payoffRatio: avgLossKrw === null ? null : (avgWinKrw ?? 0) / Math.abs(avgLossKrw),
    profitFactor: lossIdx.length === 0 ? null : grossProfitKrw / Math.abs(grossLossKrw),
    maxWinStreak,
    maxLossStreak,
    holding: days.length
      ? { avgDays: mean(days)!, medianDays: median(days), minDays: Math.min(...days), maxDays: Math.max(...days) }
      : null,
  };
}

/** 자산 추이의 한 시점 (예: daily_snapshots의 총자산) */
export interface EquityPoint {
  /** epoch ms */
  time: number;
  value: number;
}

export interface DrawdownResult {
  /** 최대 낙폭 (0 이하, -0.153 = -15.3%) */
  mdd: number;
  /** MDD 구간의 고점·저점 */
  peakTime: number;
  peakValue: number;
  troughTime: number;
  troughValue: number;
  /** 고점을 다시 회복한 시각. 아직 못 했으면 null */
  recoveredTime: number | null;
  /** 마지막 시점의 낙폭 (직전 최고점 대비, 0 이하) */
  current: number;
}

/** 최대 낙폭(MDD). 데이터가 없으면 null. 같은 낙폭이면 먼저 생긴 구간 */
export function calcMaxDrawdown(points: readonly EquityPoint[]): DrawdownResult | null {
  const sorted = [...points].filter((p) => p.value > 0).sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return null;

  let peak = sorted[0]!;
  let best: DrawdownResult = {
    mdd: 0,
    peakTime: peak.time,
    peakValue: peak.value,
    troughTime: peak.time,
    troughValue: peak.value,
    recoveredTime: null,
    current: 0,
  };
  let current = 0;

  for (const p of sorted) {
    if (p.value >= peak.value) {
      // MDD 구간 고점을 회복
      if (best.recoveredTime === null && best.mdd < 0 && best.peakTime === peak.time) best.recoveredTime = p.time;
      peak = p;
      current = 0;
      continue;
    }
    current = p.value / peak.value - 1;
    if (current < best.mdd) {
      best = {
        mdd: current,
        peakTime: peak.time,
        peakValue: peak.value,
        troughTime: p.time,
        troughValue: p.value,
        recoveredTime: null,
        current: 0,
      };
    }
  }
  return { ...best, current };
}
