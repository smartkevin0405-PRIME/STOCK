// 규칙 기반 코치: 매매 기록을 규칙으로 분석해서 습관을 짚어줌 — 순수 함수
// 투자 조언이 아니라 "내 기록이 이렇다"를 보여주는 것. 특정 종목 매수/매도 추천은 하지 않음.
import type { Fill, Market } from '@stock/shared';
import { buildClosedTrades, krwConverter, sortFills } from './stats';

/** 코치 분석용 체결. Fill에 체결 당시 정보를 덧붙임 */
export interface CoachFill extends Fill {
  /** 체결 시점의 당일 등락률 (전일 종가 대비, 0.05 = +5%). 없으면 추격매수 판단에서 제외 */
  dayChangeRate?: number;
}

export interface CoachOptions {
  /** 달러 거래 원화 환산 환율. 달러 거래가 있으면 필수 */
  usdKrw?: number;
  /** 추격매수 기준 당일 등락률 (기본 +5%) */
  chaseThreshold?: number;
  /** 내 손절 원칙 (예: -0.05). 정하지 않으면 손절 미준수 분석을 건너뜀 */
  stopLossRate?: number;
  /** 손절선보다 이만큼 더 떨어져서 팔았으면 미준수 (기본 2%p — 체결 오차 감안) */
  stopLossSlack?: number;
  /** 하루 평균 매매 횟수가 이 이상이면 과매매 (기본 10회) */
  overtradePerDay?: number;
  /** "장 시작 직후"로 볼 시간 (기본 10분) */
  openWindowMinutes?: number;
  /** "장 마감 직전"으로 볼 시간 (기본 30분) */
  closeWindowMinutes?: number;
  /** 시간대 승률 차이가 이 이상이면 경고 (기본 15%p) */
  timeOfDayGap?: number;
  /** 경고를 띄우기 위한 최소 표본 수 (기본 3) */
  minSamples?: number;
}

const DEFAULTS = {
  chaseThreshold: 0.05,
  stopLossSlack: 0.02,
  overtradePerDay: 10,
  openWindowMinutes: 10,
  closeWindowMinutes: 30,
  timeOfDayGap: 0.15,
  minSamples: 3,
};

export type CoachRuleId = 'chasing' | 'stopLoss' | 'averagingDown' | 'overtrading' | 'timeOfDay';

interface FindingBase<R extends CoachRuleId, D> {
  rule: R;
  /** 고쳐볼 만한 습관이 보이면 true */
  triggered: boolean;
  title: string;
  /** 화면에 그대로 보여줄 한 줄 요약 */
  message: string;
  data: D;
}

export interface ChasingData {
  /** 추격매수 건수 */
  count: number;
  /** 그중 다 팔아서 결과가 나온 건수 */
  closed: number;
  losses: number;
  /** losses / closed */
  lossRate: number | null;
  avgPnlRate: number | null;
}

export interface StopLossData {
  stopLossRate: number;
  /** 청산 거래 수 */
  closed: number;
  violations: number;
  /** 미준수 거래의 평균 매도 시점 등락률 */
  avgViolationRate: number | null;
  worstRate: number | null;
}

export interface AveragingDownData {
  /** 손실 중 추가매수 횟수 */
  buys: number;
  /** 물타기가 있었던 종목 중 다 판 건수 (매수~전량매도 = 1건) */
  closedCycles: number;
  /** 그 종목들의 평균 수익률 */
  avgReturn: number | null;
  /** 물타기 없이 다 판 종목들의 평균 수익률 (비교용) */
  otherAvgReturn: number | null;
}

export interface OvertradingData {
  fills: number;
  /** 한 번이라도 매매한 날 수 */
  activeDays: number;
  avgPerDay: number;
  maxPerDay: number;
  /** 수수료 + 세금 합계 (원화 환산) */
  totalCostKrw: number;
}

export type TimeBucket = 'open' | 'mid' | 'close';

export interface TimeBucketStats {
  /** rest = 장 시작 직후를 뺀 나머지 전부 */
  bucket: TimeBucket | 'rest';
  label: string;
  /** 다 팔아서 결과가 나온 매수 건수 */
  count: number;
  wins: number;
  winRate: number | null;
}

export interface TimeOfDayData {
  buckets: TimeBucketStats[];
  /** 장 시작 직후 vs 나머지 시간 */
  open: TimeBucketStats;
  rest: TimeBucketStats;
}

export type ChasingFinding = FindingBase<'chasing', ChasingData>;
export type StopLossFinding = FindingBase<'stopLoss', StopLossData>;
export type AveragingDownFinding = FindingBase<'averagingDown', AveragingDownData>;
export type OvertradingFinding = FindingBase<'overtrading', OvertradingData>;
export type TimeOfDayFinding = FindingBase<'timeOfDay', TimeOfDayData>;

export type CoachFinding = ChasingFinding | StopLossFinding | AveragingDownFinding | OvertradingFinding | TimeOfDayFinding;

export interface CoachReport {
  /** 경고가 있는 항목 먼저 */
  findings: CoachFinding[];
  disclaimer: string;
}

export const COACH_DISCLAIMER = '모의투자 기록을 분석한 참고용 내용이에요. 투자 조언이 아니에요.';

// ─── 공통 도우미 ────────────────────────────────────────────

const SESSION: Record<Market, { timeZone: string; open: number; close: number }> = {
  KR: { timeZone: 'Asia/Seoul', open: 9 * 60, close: 15 * 60 + 30 },
  US: { timeZone: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },
};

const marketOf = (f: Fill): Market => (f.currency === 'KRW' ? 'KR' : 'US');

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** 시장 현지 날짜(YYYY-MM-DD)와 하루 중 분(0~1439) */
function localClock(ts: number, timeZone: string): { date: string; minutes: number } {
  let f = clockFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    clockFormatters.set(timeZone, f);
  }
  const parts = f.formatToParts(new Date(ts));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** 0.123 → "12%", signed면 "+12%" */
export function pct(rate: number, signed = false): string {
  const v = Math.round(rate * 100);
  return `${signed && v > 0 ? '+' : ''}${v}%`;
}

/** 42000 → "4.2만원", 3500 → "3,500원" */
export function krwShort(amount: number): string {
  const v = Math.round(amount);
  if (Math.abs(v) >= 10_000) return `${String(Math.round(v / 1000) / 10).replace(/\.0$/, '')}만원`;
  return `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;
}

export interface ClosedLot {
  buy: CoachFill;
  /** 매수·매도 수수료와 세금까지 뺀 손익 (해당 통화) */
  pnl: number;
  /** pnl / 매수금액 */
  pnlRate: number;
}

/**
 * 매수 체결 1건마다 결과를 계산 (먼저 산 것부터 판다고 봄 — FIFO).
 * 전부 팔린 매수만 돌려줌. 수수료·세금은 수량 비례로 나눔.
 */
export function closedBuyLots(fills: readonly CoachFill[]): ClosedLot[] {
  type Open = { buy: CoachFill; remaining: number; pnl: number };
  const queues = new Map<string, Open[]>();
  const done: ClosedLot[] = [];

  for (const f of sortFills(fills)) {
    const q = queues.get(f.code) ?? [];
    queues.set(f.code, q);
    if (f.side === 'buy') {
      q.push({ buy: f, remaining: f.qty, pnl: -f.commission });
      continue;
    }
    let remaining = f.qty;
    const sellCostPerShare = (f.commission + f.tax) / f.qty;
    while (remaining > 0) {
      const lot = q[0];
      if (!lot) throw new Error(`보유 수량보다 많이 팔 수 없어요: ${f.code}`);
      const used = Math.min(lot.remaining, remaining);
      lot.pnl += (f.price - lot.buy.price) * used - sellCostPerShare * used;
      lot.remaining -= used;
      remaining -= used;
      if (lot.remaining === 0) {
        q.shift();
        done.push({ buy: lot.buy, pnl: lot.pnl, pnlRate: lot.pnl / lot.buy.amount });
      }
    }
  }
  return done;
}

// ─── 규칙 ───────────────────────────────────────────────────

/** 추격매수: 당일 크게 오른 뒤 산 거래의 결과 */
export function checkChasing(fills: readonly CoachFill[], options: CoachOptions = {}): ChasingFinding | null {
  const { chaseThreshold, minSamples } = { ...DEFAULTS, ...options };
  const isChase = (f: CoachFill) => f.side === 'buy' && f.dayChangeRate !== undefined && f.dayChangeRate >= chaseThreshold;

  const count = fills.filter(isChase).length;
  if (count === 0) return null;

  const lots = closedBuyLots(fills).filter((l) => isChase(l.buy));
  const losses = lots.filter((l) => l.pnl < 0).length;
  const lossRate = lots.length ? losses / lots.length : null;
  const avgPnlRate = mean(lots.map((l) => l.pnlRate));

  const message =
    lots.length === 0
      ? `당일 ${pct(chaseThreshold, true)} 이상 오른 뒤 산 거래 ${count}건 (아직 결과가 나온 거래 없음)`
      : `당일 ${pct(chaseThreshold, true)} 이상 오른 뒤 산 거래 ${count}건, 결과가 나온 ${lots.length}건 중 ${losses}건 손실`;

  return {
    rule: 'chasing',
    triggered: lots.length >= minSamples && lossRate !== null && lossRate >= 0.5,
    title: '추격매수',
    message,
    data: { count, closed: lots.length, losses, lossRate, avgPnlRate },
  };
}

/** 손절 미준수: 손절선보다 훨씬 더 떨어진 뒤에 판 거래 */
export function checkStopLoss(fills: readonly CoachFill[], options: CoachOptions = {}): StopLossFinding | null {
  const { stopLossRate } = options;
  if (stopLossRate === undefined) return null;
  const { stopLossSlack } = { ...DEFAULTS, ...options };

  const trades = buildClosedTrades(fills);
  if (trades.length === 0) return null;

  const bad = trades.filter((t) => t.priceRate <= stopLossRate - stopLossSlack);
  const rates = bad.map((t) => t.priceRate);
  const avgViolationRate = mean(rates);
  const worstRate = rates.length ? Math.min(...rates) : null;

  return {
    rule: 'stopLoss',
    triggered: bad.length > 0,
    title: '손절 원칙',
    message:
      bad.length === 0
        ? `${pct(stopLossRate)} 손절 원칙을 ${trades.length}건 모두 지켰어요`
        : `${pct(stopLossRate)} 손절 정해놓고 평균 ${pct(avgViolationRate!)}까지 버틴 거래 ${bad.length}건 (최대 ${pct(worstRate!)})`,
    data: { stopLossRate, closed: trades.length, violations: bad.length, avgViolationRate, worstRate },
  };
}

/** 물타기: 손실 중(현재가 < 평균단가) 추가매수한 종목의 최종 수익률 */
export function checkAveragingDown(fills: readonly CoachFill[], options: CoachOptions = {}): AveragingDownFinding | null {
  const { minSamples } = { ...DEFAULTS, ...options };
  type Cycle = { qty: number; cost: number; invested: number; pnl: number; averagedDown: boolean };
  const cycles = new Map<string, Cycle>();
  const withAD: number[] = [];
  const without: number[] = [];
  let buys = 0;

  for (const f of sortFills(fills)) {
    let c = cycles.get(f.code);
    if (!c) {
      c = { qty: 0, cost: 0, invested: 0, pnl: 0, averagedDown: false };
      cycles.set(f.code, c);
    }
    if (f.side === 'buy') {
      if (c.qty > 0 && f.price < c.cost / c.qty) {
        buys++;
        c.averagedDown = true;
      }
      c.qty += f.qty;
      c.cost += f.amount;
      c.invested += f.amount;
      c.pnl -= f.commission;
      continue;
    }
    if (c.qty < f.qty) throw new Error(`보유 수량보다 많이 팔 수 없어요: ${f.code}`);
    const cost = (c.cost / c.qty) * f.qty;
    c.pnl += f.amount - cost - f.commission - f.tax;
    c.qty -= f.qty;
    c.cost -= cost;
    if (c.qty === 0) {
      (c.averagedDown ? withAD : without).push(c.pnl / c.invested);
      cycles.delete(f.code);
    }
  }

  if (buys === 0 && withAD.length === 0) return null;
  const avgReturn = mean(withAD);
  const otherAvgReturn = mean(without);

  return {
    rule: 'averagingDown',
    triggered: withAD.length >= minSamples && avgReturn !== null && avgReturn < 0,
    title: '물타기',
    message:
      avgReturn === null
        ? `손실 중 추가매수 ${buys}회 (아직 다 판 종목 없음)`
        : `손실 중 추가매수한 종목 평균 수익률 ${pct(avgReturn, true)}` +
          (otherAvgReturn === null ? '' : `, 그 외 종목 ${pct(otherAvgReturn, true)}`),
    data: { buys, closedCycles: withAD.length, avgReturn, otherAvgReturn },
  };
}

/** 과매매: 매매한 날 하루 평균 매매 횟수와 수수료·세금 지출 */
export function checkOvertrading(fills: readonly CoachFill[], options: CoachOptions = {}): OvertradingFinding | null {
  if (fills.length === 0) return null;
  const { overtradePerDay } = { ...DEFAULTS, ...options };
  const toKrw = krwConverter(options.usdKrw);

  const perDay = new Map<string, number>();
  let totalCost = 0;
  for (const f of fills) {
    const m = marketOf(f);
    const key = `${m}:${localClock(f.executedAt, SESSION[m].timeZone).date}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
    totalCost += toKrw(f.commission + f.tax, f.currency);
  }
  const activeDays = perDay.size;
  const avgPerDay = fills.length / activeDays;
  const totalCostKrw = Math.round(totalCost);

  return {
    rule: 'overtrading',
    triggered: avgPerDay >= overtradePerDay,
    title: '매매 횟수',
    message: `매매한 날 하루 평균 ${Math.round(avgPerDay * 10) / 10}회 매매, 수수료·세금으로 총 ${krwShort(totalCostKrw)} 지출`,
    data: { fills: fills.length, activeDays, avgPerDay, maxPerDay: Math.max(...perDay.values()), totalCostKrw },
  };
}

/** 시간대별 승률: 매수한 시각(장 시작 직후 / 장중 / 마감 직전)별로 결과 비교 */
export function checkTimeOfDay(fills: readonly CoachFill[], options: CoachOptions = {}): TimeOfDayFinding | null {
  const { openWindowMinutes, closeWindowMinutes, timeOfDayGap, minSamples } = { ...DEFAULTS, ...options };
  const lots = closedBuyLots(fills);
  if (lots.length === 0) return null;

  const bucketOf = (f: CoachFill): TimeBucket => {
    const s = SESSION[marketOf(f)];
    const { minutes } = localClock(f.executedAt, s.timeZone);
    if (minutes < s.open + openWindowMinutes) return 'open';
    if (minutes >= s.close - closeWindowMinutes) return 'close';
    return 'mid';
  };
  const labels: Record<TimeBucket, string> = {
    open: `장 시작 ${openWindowMinutes}분`,
    mid: '장중',
    close: `마감 전 ${closeWindowMinutes}분`,
  };

  const tally = (bucket: TimeBucketStats['bucket'], label: string, picked: ClosedLot[]): TimeBucketStats => {
    const wins = picked.filter((l) => l.pnl > 0).length;
    return { bucket, label, count: picked.length, wins, winRate: picked.length ? wins / picked.length : null };
  };

  const tagged = lots.map((l) => ({ lot: l, bucket: bucketOf(l.buy) }));
  const buckets = (['open', 'mid', 'close'] as const).map((b) =>
    tally(b, labels[b], tagged.filter((t) => t.bucket === b).map((t) => t.lot)),
  );
  const open = buckets[0]!;
  const rest = tally('rest', '나머지 시간', tagged.filter((t) => t.bucket !== 'open').map((t) => t.lot));

  const comparable = open.count >= minSamples && rest.count >= minSamples;
  const message =
    open.winRate !== null && rest.winRate !== null
      ? `${labels.open} 내 매수 승률 ${pct(open.winRate)}, 나머지 시간 ${pct(rest.winRate)}`
      : buckets
          .filter((b) => b.winRate !== null)
          .map((b) => `${b.label} 매수 승률 ${pct(b.winRate!)}`)
          .join(', ');

  return {
    rule: 'timeOfDay',
    triggered: comparable && rest.winRate! - open.winRate! >= timeOfDayGap,
    title: '시간대별 승률',
    message,
    data: { buckets, open, rest },
  };
}

/** 모든 규칙을 돌려서 리포트로 묶음. 데이터가 부족한 규칙은 빠짐 */
export function runCoach(fills: readonly CoachFill[], options: CoachOptions = {}): CoachReport {
  const findings = [checkChasing, checkStopLoss, checkAveragingDown, checkOvertrading, checkTimeOfDay]
    .map((rule) => rule(fills, options))
    .filter((f): f is CoachFinding => f !== null);
  // 경고 먼저, 같은 그룹 안에서는 규칙 순서 유지
  findings.sort((a, b) => Number(b.triggered) - Number(a.triggered));
  return { findings, disclaimer: COACH_DISCLAIMER };
}
