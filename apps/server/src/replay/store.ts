import type { ReplayResult } from '@stock/shared';
import type { DatabaseSync } from 'node:sqlite';

interface Row {
  id: number;
  scenario_id: string;
  codes: string;
  start_cash: number;
  final_value: number;
  return_rate: number;
  trade_count: number;
  finished_at: number;
}

const toResult = (r: Row): ReplayResult => ({
  id: r.id,
  scenarioId: r.scenario_id,
  codes: JSON.parse(r.codes) as string[],
  startCash: r.start_cash,
  finalValue: r.final_value,
  returnRate: r.return_rate,
  tradeCount: r.trade_count,
  finishedAt: r.finished_at,
});

/** 리플레이 결과 저장 (본 계좌·시즌과 상관없이 남음) */
export class ReplayStore {
  constructor(
    private readonly db: DatabaseSync,
    /** 테스트에서 시각 고정용 */
    readonly now: () => number = Date.now,
    private readonly userId = 1,
  ) {}

  save(r: Omit<ReplayResult, 'id'>): ReplayResult {
    const res = this.db
      .prepare(
        `INSERT INTO replay_results (user_id, scenario_id, codes, start_cash, final_value, return_rate, trade_count, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(this.userId, r.scenarioId, JSON.stringify(r.codes), r.startCash, r.finalValue, r.returnRate, r.tradeCount, r.finishedAt);
    return { id: Number(res.lastInsertRowid), ...r };
  }

  /** 최근 순 */
  list(scenarioId?: string, limit = 50): ReplayResult[] {
    const rows = scenarioId
      ? this.db
          .prepare('SELECT * FROM replay_results WHERE user_id = ? AND scenario_id = ? ORDER BY finished_at DESC, id DESC LIMIT ?')
          .all(this.userId, scenarioId, limit)
      : this.db.prepare('SELECT * FROM replay_results WHERE user_id = ? ORDER BY finished_at DESC, id DESC LIMIT ?').all(this.userId, limit);
    return (rows as unknown as Row[]).map(toResult);
  }
}
