import type { WatchGroup } from '@stock/shared';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './db';
import { TradingError } from './service';

const DEFAULT_NAME = '관심 종목';
const DEFAULT_CODES = ['005930', '000660', 'AAPL', 'NVDA', 'TSLA'];
const MAX_GROUPS = 20;
const MAX_ITEMS = 200;

/** 관심종목 그룹: 추가·이름 변경·삭제·순서 변경 */
export class WatchlistService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
    private readonly userId = 1,
  ) {}

  /** 그룹이 하나도 없으면 기본 그룹을 만들어서 돌려줌 */
  list(): WatchGroup[] {
    let groups = this.db.prepare('SELECT id, name FROM watch_groups WHERE user_id = ? ORDER BY sort_order, id').all(this.userId) as { id: number; name: string }[];
    if (groups.length === 0) {
      const g = this.create(DEFAULT_NAME);
      this.setCodes(g.id, DEFAULT_CODES);
      groups = [{ id: g.id, name: g.name }];
    }
    const items = this.db
      .prepare('SELECT i.group_id, i.code FROM watch_items i JOIN watch_groups g ON g.id = i.group_id WHERE g.user_id = ? ORDER BY i.sort_order')
      .all(this.userId) as { group_id: number; code: string }[];
    return groups.map((g) => ({ id: g.id, name: g.name, codes: items.filter((i) => i.group_id === g.id).map((i) => i.code) }));
  }

  create(name: string): WatchGroup {
    const n = this.cleanName(name);
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM watch_groups WHERE user_id = ?').get(this.userId) as { n: number }).n;
    if (count >= MAX_GROUPS) throw new TradingError('TOO_MANY', `그룹은 ${MAX_GROUPS}개까지 만들 수 있어요`);
    const res = this.db
      .prepare('INSERT INTO watch_groups (user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)')
      .run(this.userId, n, count, this.now());
    return { id: Number(res.lastInsertRowid), name: n, codes: [] };
  }

  rename(id: number, name: string): WatchGroup {
    this.own(id);
    this.db.prepare('UPDATE watch_groups SET name = ? WHERE id = ?').run(this.cleanName(name), id);
    return this.get(id);
  }

  /** 마지막 남은 그룹은 못 지움 */
  remove(id: number): void {
    this.own(id);
    if (this.list().length <= 1) throw new TradingError('LAST_GROUP', '그룹이 하나는 있어야 해요');
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM watch_items WHERE group_id = ?').run(id);
      this.db.prepare('DELETE FROM watch_groups WHERE id = ?').run(id);
    });
  }

  /** 종목 목록 통째로 교체 (순서 변경·삭제에 사용) */
  setCodes(id: number, codes: string[]): WatchGroup {
    this.own(id);
    const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))].slice(0, MAX_ITEMS);
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM watch_items WHERE group_id = ?').run(id);
      const insert = this.db.prepare('INSERT INTO watch_items (group_id, code, sort_order) VALUES (?, ?, ?)');
      unique.forEach((code, i) => insert.run(id, code, i));
    });
    return this.get(id);
  }

  /** 맨 뒤에 추가 (이미 있으면 그대로) */
  add(id: number, code: string): WatchGroup {
    const g = this.get(id);
    return g.codes.includes(code) ? g : this.setCodes(id, [...g.codes, code]);
  }

  removeCode(id: number, code: string): WatchGroup {
    const g = this.get(id);
    return this.setCodes(id, g.codes.filter((c) => c !== code));
  }

  private get(id: number): WatchGroup {
    const g = this.list().find((x) => x.id === id);
    if (!g) throw new TradingError('NOT_FOUND', '그룹을 찾을 수 없어요', 404);
    return g;
  }

  private own(id: number): void {
    const row = this.db.prepare('SELECT user_id FROM watch_groups WHERE id = ?').get(id) as { user_id: number } | undefined;
    if (!row || row.user_id !== this.userId) throw new TradingError('NOT_FOUND', '그룹을 찾을 수 없어요', 404);
  }

  private cleanName(name: string): string {
    const n = name.trim().slice(0, 20);
    if (!n) throw new TradingError('BAD_NAME', '그룹 이름을 입력해주세요');
    return n;
  }
}
