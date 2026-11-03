import { buildClosedTrades, calcMaxDrawdown, type ClosedTrade } from '@stock/core';
import type { Achievement, AchievementUnlock, AchievementsView, Challenge } from '@stock/shared';
import type { DatabaseSync } from 'node:sqlite';
import { adjustForSplits } from './corporate';
import type { TradingService } from './service';
import { periodStart } from './stats';

const KST = 9 * 3_600_000;
/** 손절선보다 이만큼 더 떨어진 뒤 팔면 '원칙 지킴'이 아님 (코치와 같은 2%p) */
export const STOP_SLACK = 0.02;
/** 손절선에 살짝 못 미쳐 미리 판 것도 인정 (1%p) */
export const STOP_EARLY = 0.01;
const DEFAULT_GROUP = '관심 종목';

/** 손절 원칙을 지킨 매도인지: 손절선 근처(-2%p ~ +1%p)에서 손실로 판 경우 */
export function keptStopLoss(priceRate: number, stopLossRate: number): boolean {
  return priceRate < 0 && priceRate >= stopLossRate - STOP_SLACK - 1e-9 && priceRate <= stopLossRate + STOP_EARLY + 1e-9;
}

/** 한국시간 기준 이번 달: 키('2026-11'), 시작·끝 (epoch ms) */
export function monthRange(now: number): { month: string; start: number; end: number } {
  const d = new Date(now + KST);
  return {
    month: d.toISOString().slice(0, 7),
    start: periodStart('month', now)!,
    end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - KST,
  };
}

/** 업적 판단에 쓰는 기록 요약 (모든 시즌) */
export interface Facts {
  buys: number;
  usBuys: number;
  fxTrades: number;
  closedSeasons: number;
  /** 끝난 시즌 최종 수익률·하루 기록 중 가장 높은 수익률 (지금 시즌의 지금 값은 따로) */
  bestSeasonReturn: number;
  alerts: number;
  /** 기본 그룹 말고 직접 만든 그룹이 있는지 */
  ownWatchGroup: boolean;
  notes: number;
  /** 청산 거래 (모든 시즌, 청산 순) */
  trades: ClosedTrade[];
  wins: number;
  maxWinStreak: number;
  stopLossRate?: number;
  stopKept: number;
  /** 타임머신 리플레이 완주 횟수 */
  replays: number;
  /** 2020 코로나 시나리오를 손실 없이 마쳤는지 */
  covidSurvived: boolean;
  bestReplayReturn: number;
}

interface AchievementDef {
  id: string;
  icon: string;
  title: string;
  desc: string;
  done: (f: Facts) => boolean;
  progress?: (f: Facts) => number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** 업적 목록 (화면 순서). 리플레이 업적은 저장된 리플레이 결과로 판단 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'firstBuy', icon: '🛒', title: '첫 매수', desc: '처음으로 주식을 샀어요', done: (f) => f.buys > 0 },
  { id: 'firstProfit', icon: '💰', title: '첫 익절', desc: '수익을 내고 팔았어요', done: (f) => f.wins > 0 },
  {
    id: 'winStreak3',
    icon: '🔥',
    title: '3연승',
    desc: '수익 매도 3번 연속',
    done: (f) => f.maxWinStreak >= 3,
    progress: (f) => f.maxWinStreak / 3,
  },
  {
    id: 'winStreak10',
    icon: '👑',
    title: '10연승',
    desc: '수익 매도 10번 연속',
    done: (f) => f.maxWinStreak >= 10,
    progress: (f) => f.maxWinStreak / 10,
  },
  { id: 'usDebut', icon: '🇺🇸', title: '미국주식 데뷔', desc: '미국 주식을 처음 샀어요', done: (f) => f.usBuys > 0 },
  { id: 'firstFx', icon: '💱', title: '첫 환전', desc: '처음으로 환전했어요', done: (f) => f.fxTrades > 0 },
  {
    id: 'journal10',
    icon: '📝',
    title: '매매일지 10개',
    desc: '매매 이유를 10번 남겼어요',
    done: (f) => f.notes >= 10,
    progress: (f) => f.notes / 10,
  },
  { id: 'stopLossKept', icon: '🛡️', title: '손절 원칙 지키기', desc: '정해둔 손절 기준 근처에서 손절했어요', done: (f) => f.stopKept > 0 },
  { id: 'seasonReturn10', icon: '🚀', title: '시즌 수익률 +10%', desc: '한 시즌에서 +10%를 넘겼어요', done: (f) => f.bestSeasonReturn >= 0.1 },
  { id: 'firstSeasonEnd', icon: '🏁', title: '첫 시즌 마감', desc: '계좌를 리셋하고 시즌을 마쳤어요', done: (f) => f.closedSeasons > 0 },
  { id: 'firstAlert', icon: '🔔', title: '가격 알림 첫 설정', desc: '가격 알림을 처음 걸었어요', done: (f) => f.alerts > 0 },
  { id: 'watchGroup', icon: '⭐', title: '관심 그룹 만들기', desc: '나만의 관심종목 그룹을 만들었어요', done: (f) => f.ownWatchGroup },
  { id: 'replayFirst', icon: '🕰️', title: '시간 여행자', desc: '타임머신 리플레이를 처음 끝까지 했어요', done: (f) => f.replays > 0 },
  { id: 'covidSurvivor', icon: '🦠', title: '코로나장 생존', desc: '2020 코로나 폭락 리플레이를 손실 없이 마쳤어요', done: (f) => f.covidSurvived },
  { id: 'replayPro', icon: '🧠', title: '리플레이 +20%', desc: '리플레이에서 +20% 넘게 벌었어요', done: (f) => f.bestReplayReturn >= 0.2 },
];

const CHALLENGES = {
  profit5: { icon: '📈', title: '이번 달 +5%', desc: '이번 달 첫 기록보다 총자산 +5%' },
  stopLoss10: { icon: '🛡️', title: '손절 원칙 10번 지키기', desc: '정해둔 손절 기준 근처에서 10번 손절' },
  mdd10: { icon: '🧘', title: 'MDD -10% 이내로 한 달 버티기', desc: '이번 달 최대 낙폭을 -10% 안으로' },
  journal10: { icon: '📝', title: '이번 달 매매일지 10개', desc: '이번 달 매매 이유 10번 남기기' },
} as const;
type ChallengeId = keyof typeof CHALLENGES;

const PROFIT_TARGET = 0.05;
const STOP_TARGET = 10;
const MDD_LIMIT = -0.1;
const JOURNAL_TARGET = 10;

/** 챌린지 달성 기록 키 */
const challengeKey = (id: ChallengeId, month: string) => `challenge:${id}:${month}`;

type Row = Record<string, unknown>;

export interface AchievementServiceOptions {
  trading: TradingService;
  now?: () => number;
  userId?: number;
}

/**
 * 업적·챌린지: 기록에서 계산해서 달성하면 저장 (한 번 달성하면 계속 유지).
 * 매매 이벤트·설정 변경 뒤에 check()로 다시 확인 → 새로 달성한 건 onUnlock으로 알림.
 */
export class AchievementService {
  private readonly db: DatabaseSync;
  private readonly trading: TradingService;
  private readonly now: () => number;
  private readonly userId: number;
  private readonly listeners = new Set<(u: AchievementUnlock) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(o: AchievementServiceOptions) {
    this.trading = o.trading;
    this.db = o.trading.repo.db;
    this.now = o.now ?? Date.now;
    this.userId = o.userId ?? 1;
  }

  onUnlock(listener: (u: AchievementUnlock) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 매매 이벤트 받기 시작. 처음엔 지금까지 기록으로 조용히(알림 없이) 채움 */
  start(): () => void {
    void this.check({ silent: true }).catch(() => undefined);
    return this.trading.onEvent((e) => {
      if (e.event === 'fill' || e.event === 'fx' || e.event === 'reset') void this.check().catch(() => undefined);
    });
  }

  /** 다시 확인하고 새로 달성한 것 반환. 동시에 여러 번 불려도 차례대로 */
  check(opts: { silent?: boolean } = {}): Promise<AchievementUnlock[]> {
    const run = this.queue.then(() => this.run(opts.silent ?? false));
    this.queue = run.catch(() => undefined);
    return run.then((r) => r.unlocked);
  }

  /** 화면용: 업적(달성 시각 포함) + 이번 달 챌린지 */
  async view(): Promise<AchievementsView> {
    const run = this.queue.then(() => this.run(false));
    this.queue = run.catch(() => undefined);
    const { facts, challenges } = await run;
    const rows = this.rows();
    const achievements = ACHIEVEMENTS.map((d): Achievement => {
      const at = rows.get(d.id);
      if (at !== undefined) return { id: d.id, icon: d.icon, title: d.title, desc: d.desc, unlockedAt: at };
      return { id: d.id, icon: d.icon, title: d.title, desc: d.desc, ...(d.progress ? { progress: clamp01(d.progress(facts)) } : {}) };
    });
    return { achievements, challenges };
  }

  /** 밖에서 직접 달성 처리 (리플레이 업적 등). 새로 달성했으면 true */
  grant(id: string): boolean {
    const def = ACHIEVEMENTS.find((d) => d.id === id);
    if (!def) return false;
    const at = this.now();
    if (!this.insert(id, at)) return false;
    this.emit({ kind: 'achievement', id, icon: def.icon, title: def.title, unlockedAt: at });
    return true;
  }

  // ── 내부 ──────────────────────────────────────────────

  private async run(silent: boolean): Promise<{ facts: Facts; challenges: Challenge[]; unlocked: AchievementUnlock[] }> {
    // DB 기록은 먼저 다 읽고, 시세가 필요한 지금 자산은 그다음에
    const now = this.now();
    const facts = this.facts();
    const range = monthRange(now);
    const acc = this.trading.account();
    const monthSnaps = this.trading.repo.snapshots(acc.id).filter((s) => s.day.slice(0, 7) === range.month);
    const monthNotes = this.count(
      `SELECT COUNT(*) AS n FROM journal_notes j JOIN accounts a ON a.id = j.account_id
       WHERE a.user_id = ? AND (j.text <> '' OR j.tags <> '[]') AND j.created_at >= ? AND j.created_at < ?`,
      range.start,
      range.end,
    );
    const current = await this.trading.currentValue().then(
      (v) => v.totalKrw,
      () => undefined,
    );

    const unlocked: AchievementUnlock[] = [];
    const rows = this.rows();
    /** at: 실제로 달성한 시각 (기록에서 찾으면 그 시각, 못 찾으면 지금) */
    const unlock = (kind: AchievementUnlock['kind'], id: string, icon: string, title: string, at = now) => {
      const when = Math.min(at, now);
      const stored = rows.get(id);
      if (stored !== undefined) {
        // 예전에 '확인한 시각'으로 저장된 건 기록상 더 이른 실제 시각으로 고침
        if (when < stored) this.setTime(id, when);
        return;
      }
      if (!this.insert(id, when)) return;
      rows.set(id, when);
      unlocked.push({ kind, id, icon, title, unlockedAt: when });
    };

    if (current !== undefined && acc.seedKrw > 0) facts.bestSeasonReturn = Math.max(facts.bestSeasonReturn, current / acc.seedKrw - 1);
    const times = this.unlockTimes(facts);
    for (const d of ACHIEVEMENTS) if (d.done(facts)) unlock('achievement', d.id, d.icon, d.title, times[d.id]);

    const challenges = this.challenges({ facts, range, now, monthSnaps, monthNotes, current, recorded: rows });
    for (const c of challenges) {
      if (c.status === 'done') unlock('challenge', challengeKey(c.id as ChallengeId, range.month), c.icon, c.title);
    }

    // 지난달 MDD 챌린지: 한 달이 다 끝나야 판단 가능 → 이번 달이 되면 지난달 결과로 달성 처리
    const last = this.lastMonthMdd(acc.id, range);
    if (last && last.mdd >= MDD_LIMIT - 1e-12) {
      const c = CHALLENGES.mdd10;
      unlock('challenge', challengeKey('mdd10', last.month), c.icon, `${c.title} (${Number(last.month.slice(5))}월)`, range.start);
    }

    if (!silent) for (const u of unlocked) this.emit(u);
    return { facts, challenges, unlocked };
  }

  private challenges(x: {
    facts: Facts;
    range: { month: string; start: number; end: number };
    now: number;
    monthSnaps: { day: string; totalKrw: number }[];
    monthNotes: number;
    current: number | undefined;
    recorded: Map<string, number>;
  }): Challenge[] {
    const { facts, range, now, monthSnaps, current } = x;
    const isRecorded = (id: ChallengeId) => x.recorded.has(challengeKey(id, range.month));
    const base = (id: ChallengeId) => ({ id, ...CHALLENGES[id], month: range.month, endsAt: range.end });

    // 이번 달 +5%: 이번 달 첫 하루 기록 → 지금
    const start = monthSnaps[0]?.totalKrw;
    const rate = start && current !== undefined ? current / start - 1 : 0;
    const profitDone = isRecorded('profit5') || rate >= PROFIT_TARGET;
    const profit: Challenge = {
      ...base('profit5'),
      unit: 'rate',
      value: rate,
      target: PROFIT_TARGET,
      progress: profitDone ? 1 : clamp01(rate / PROFIT_TARGET),
      status: profitDone ? 'done' : 'active',
    };

    // 손절 원칙 10번: 손절 기준이 있어야 시작
    const kept = facts.stopLossRate === undefined
      ? 0
      : facts.trades.filter((t) => t.closedAt >= range.start && t.closedAt < range.end && keptStopLoss(t.priceRate, facts.stopLossRate!)).length;
    const stopDone = isRecorded('stopLoss10') || kept >= STOP_TARGET;
    const stop: Challenge = {
      ...base('stopLoss10'),
      unit: 'count',
      value: kept,
      target: STOP_TARGET,
      progress: stopDone ? 1 : clamp01(kept / STOP_TARGET),
      status: stopDone ? 'done' : facts.stopLossRate === undefined ? 'needsSetting' : 'active',
      ...(facts.stopLossRate === undefined && !stopDone ? { hint: '손절 기준을 정하면 시작돼요' } : {}),
    };

    // MDD: 이번 달 하루 기록 + 지금. 달이 끝나야 달성 → 이번 달 안에서는 진행 중/실패만 (달성은 다음 달 1일에 처리)
    const points = [...monthSnaps.map((s, i) => ({ time: i, value: s.totalKrw }))];
    if (current !== undefined) points.push({ time: points.length, value: current });
    const mdd = calcMaxDrawdown(points)?.mdd ?? 0;
    const failed = mdd < MDD_LIMIT - 1e-12;
    const mddChallenge: Challenge = {
      ...base('mdd10'),
      unit: 'rate',
      value: mdd,
      target: MDD_LIMIT,
      progress: failed ? 0 : clamp01((now - range.start) / (range.end - range.start)),
      status: failed ? 'failed' : 'active',
      ...(failed ? {} : { hint: '이달 마지막 날까지 -10% 안으로 버티면 다음 달 1일에 달성돼요' }),
    };

    const journalDone = isRecorded('journal10') || x.monthNotes >= JOURNAL_TARGET;
    const journal: Challenge = {
      ...base('journal10'),
      unit: 'count',
      value: x.monthNotes,
      target: JOURNAL_TARGET,
      progress: journalDone ? 1 : clamp01(x.monthNotes / JOURNAL_TARGET),
      status: journalDone ? 'done' : 'active',
    };

    return [profit, stop, mddChallenge, journal];
  }

  /** 모든 시즌 기록 요약 (리플레이 계좌가 같은 테이블을 쓰게 되면 여기서 빼야 함) */
  facts(): Facts {
    const u = this.userId;
    const fillCount = (where: string) =>
      this.count(`SELECT COUNT(*) AS n FROM fills f JOIN accounts a ON a.id = f.account_id WHERE a.user_id = ? AND ${where}`);

    // 청산 거래: 시즌마다 따로 계산 후 청산 순으로
    const trades: ClosedTrade[] = [];
    for (const acc of this.trading.repo.accounts(u)) {
      try {
        const splits = this.trading.repo.corporateActions(acc.id).filter((a) => a.kind === 'split');
        trades.push(...buildClosedTrades(adjustForSplits(this.trading.repo.allFills(acc.id), splits)));
      } catch {
        // 기록이 어긋난 시즌은 건너뜀
      }
    }
    trades.sort((a, b) => a.closedAt - b.closedAt);
    let streak = 0;
    let maxWinStreak = 0;
    for (const t of trades) {
      streak = t.pnl > 0 ? streak + 1 : 0;
      maxWinStreak = Math.max(maxWinStreak, streak);
    }

    const setting = this.trading.repo.getSetting('stopLossRate', u);
    const stopLossRate = setting !== undefined && Number.isFinite(Number(setting)) ? Number(setting) : undefined;

    const closedBest = this.db
      .prepare('SELECT MAX(final_value_krw / seed_krw) AS r FROM accounts WHERE user_id = ? AND closed_at IS NOT NULL AND seed_krw > 0')
      .get(u) as { r: number | null };
    const snapBest = this.db
      .prepare('SELECT MAX(s.total_krw / a.seed_krw) AS r FROM daily_snapshots s JOIN accounts a ON a.id = s.account_id WHERE a.user_id = ? AND a.seed_krw > 0')
      .get(u) as { r: number | null };
    const best = Math.max(closedBest.r ?? 0, snapBest.r ?? 0);

    return {
      buys: fillCount("f.side = 'buy'"),
      usBuys: fillCount("f.side = 'buy' AND f.currency = 'USD'"),
      fxTrades: this.count('SELECT COUNT(*) AS n FROM fx_trades t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = ?'),
      closedSeasons: this.count('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ? AND closed_at IS NOT NULL'),
      bestSeasonReturn: best > 0 ? best - 1 : 0,
      alerts: this.count('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ?'),
      ownWatchGroup:
        this.count('SELECT COUNT(*) AS n FROM watch_groups WHERE user_id = ? AND name <> ?', DEFAULT_GROUP) > 0 ||
        this.count('SELECT COUNT(*) AS n FROM watch_groups WHERE user_id = ?') >= 2,
      notes: this.count(
        "SELECT COUNT(*) AS n FROM journal_notes j JOIN accounts a ON a.id = j.account_id WHERE a.user_id = ? AND (j.text <> '' OR j.tags <> '[]')",
      ),
      trades,
      wins: trades.filter((t) => t.pnl > 0).length,
      maxWinStreak,
      ...(stopLossRate !== undefined ? { stopLossRate } : {}),
      stopKept: stopLossRate === undefined ? 0 : trades.filter((t) => keptStopLoss(t.priceRate, stopLossRate)).length,
      replays: this.count('SELECT COUNT(*) AS n FROM replay_results WHERE user_id = ?'),
      covidSurvived: this.count("SELECT COUNT(*) AS n FROM replay_results WHERE user_id = ? AND scenario_id LIKE 'covid-2020-%' AND return_rate >= 0") > 0,
      bestReplayReturn:
        (this.db.prepare('SELECT MAX(return_rate) AS r FROM replay_results WHERE user_id = ?').get(u) as { r: number | null }).r ?? 0,
    };
  }

  /** 첫 번째 ?는 user_id */
  private count(sql: string, ...params: (string | number)[]): number {
    return ((this.db.prepare(sql).get(this.userId, ...params) as { n: number } | undefined)?.n ?? 0) as number;
  }

  private rows(): Map<string, number> {
    const rows = this.db.prepare('SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ?').all(this.userId) as Row[];
    return new Map(rows.map((r) => [r.achievement_id as string, r.unlocked_at as number]));
  }

  private setTime(id: string, at: number): void {
    this.db.prepare('UPDATE achievements SET unlocked_at = ? WHERE user_id = ? AND achievement_id = ?').run(at, this.userId, id);
  }

  /**
   * 지난달 MDD (이번 시즌 계좌가 지난달 내내 있었을 때만).
   * 지난달 하루 기록들 + 이번 달 첫 기록(= 지난달 마지막 날 마감 뒤 값)
   */
  private lastMonthMdd(accountId: number, range: { month: string; start: number }): { month: string; mdd: number } | null {
    const prev = monthRange(range.start - 1);
    const snaps = this.trading.repo.snapshots(accountId);
    const inPrev = snaps.filter((s) => s.day.slice(0, 7) === prev.month);
    const afterPrev = snaps.find((s) => s.day.slice(0, 7) === range.month);
    // 지난달 초(3일 안)부터 기록이 있어야 '한 달 버티기'로 인정
    if (inPrev.length === 0 || Number(inPrev[0]!.day.slice(8)) > 3 || !afterPrev) return null;
    const points = [...inPrev, afterPrev].map((s, i) => ({ time: i, value: s.totalKrw }));
    return { month: prev.month, mdd: calcMaxDrawdown(points)?.mdd ?? 0 };
  }

  /** 업적별 실제 달성 시각 (기록에서 찾을 수 있는 것만) */
  private unlockTimes(f: Facts): Record<string, number | undefined> {
    const u = this.userId;
    const one = (sql: string, ...params: (string | number)[]) =>
      ((this.db.prepare(sql).get(u, ...params) as { t: number | null } | undefined)?.t ?? undefined) as number | undefined;
    const fillAt = (where: string) =>
      one(`SELECT MIN(f.executed_at) AS t FROM fills f JOIN accounts a ON a.id = f.account_id WHERE a.user_id = ? AND ${where}`);

    // 연승은 기준 횟수를 채운 그 판매 시각
    const streakAt = (n: number) => {
      let s = 0;
      for (const t of f.trades) {
        s = t.pnl > 0 ? s + 1 : 0;
        if (s >= n) return t.closedAt;
      }
      return undefined;
    };
    const stopAt = f.stopLossRate === undefined ? undefined : f.trades.find((t) => keptStopLoss(t.priceRate, f.stopLossRate!))?.closedAt;

    return {
      firstBuy: fillAt("f.side = 'buy'"),
      firstProfit: f.trades.find((t) => t.pnl > 0)?.closedAt,
      winStreak3: streakAt(3),
      winStreak10: streakAt(10),
      usDebut: fillAt("f.side = 'buy' AND f.currency = 'USD'"),
      firstFx: one('SELECT MIN(t.executed_at) AS t FROM fx_trades t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = ?'),
      journal10: one(
        `SELECT j.created_at AS t FROM journal_notes j JOIN accounts a ON a.id = j.account_id
         WHERE a.user_id = ? AND (j.text <> '' OR j.tags <> '[]') ORDER BY j.created_at LIMIT 1 OFFSET 9`,
      ),
      stopLossKept: stopAt,
      seasonReturn10: one(
        `SELECT MIN(t) AS t FROM (
           SELECT closed_at AS t FROM accounts WHERE user_id = ?1 AND closed_at IS NOT NULL AND seed_krw > 0 AND final_value_krw >= seed_krw * 1.1
           UNION ALL
           SELECT s.created_at AS t FROM daily_snapshots s JOIN accounts a ON a.id = s.account_id WHERE a.user_id = ?1 AND a.seed_krw > 0 AND s.total_krw >= a.seed_krw * 1.1
         )`,
      ),
      firstSeasonEnd: one('SELECT MIN(closed_at) AS t FROM accounts WHERE user_id = ?'),
      firstAlert: one('SELECT MIN(created_at) AS t FROM alerts WHERE user_id = ?'),
      watchGroup:
        one('SELECT MIN(created_at) AS t FROM watch_groups WHERE user_id = ? AND name <> ?', DEFAULT_GROUP) ??
        one('SELECT created_at AS t FROM watch_groups WHERE user_id = ? ORDER BY created_at LIMIT 1 OFFSET 1'),
      replayFirst: one('SELECT MIN(finished_at) AS t FROM replay_results WHERE user_id = ?'),
      covidSurvivor: one("SELECT MIN(finished_at) AS t FROM replay_results WHERE user_id = ? AND scenario_id LIKE 'covid-2020-%' AND return_rate >= 0"),
      replayPro: one('SELECT MIN(finished_at) AS t FROM replay_results WHERE user_id = ? AND return_rate >= 0.2'),
    };
  }

  private insert(id: string, at: number): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').run(this.userId, id, at);
    return Number(r.changes) > 0;
  }

  private emit(u: AchievementUnlock): void {
    for (const l of this.listeners) l(u);
  }
}
