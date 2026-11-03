import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 버전별 스키마 변경. 새 변경은 배열 끝에 추가 (이미 적용된 건 건너뜀)
const MIGRATIONS: string[] = [
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    season INTEGER NOT NULL,
    seed_krw REAL NOT NULL,
    cash_krw REAL NOT NULL,
    cash_usd REAL NOT NULL,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    final_value_krw REAL
  );
  CREATE TABLE positions (
    account_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    qty INTEGER NOT NULL,
    avg_price REAL NOT NULL,
    currency TEXT NOT NULL,
    PRIMARY KEY (account_id, code)
  );
  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    market TEXT NOT NULL,
    side TEXT NOT NULL,
    type TEXT NOT NULL,
    qty INTEGER NOT NULL,
    limit_price REAL,
    status TEXT NOT NULL,
    hold_amount REAL NOT NULL DEFAULT 0,
    reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER
  );
  CREATE INDEX orders_by_status ON orders(account_id, status);
  CREATE TABLE fills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    side TEXT NOT NULL,
    price REAL NOT NULL,
    qty INTEGER NOT NULL,
    amount REAL NOT NULL,
    commission REAL NOT NULL,
    tax REAL NOT NULL,
    currency TEXT NOT NULL,
    realized_pnl REAL NOT NULL DEFAULT 0,
    executed_at INTEGER NOT NULL
  );
  CREATE INDEX fills_by_account ON fills(account_id, executed_at);
  CREATE TABLE fx_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    from_ccy TEXT NOT NULL,
    to_ccy TEXT NOT NULL,
    rate REAL NOT NULL,
    pay REAL NOT NULL,
    receive REAL NOT NULL,
    executed_at INTEGER NOT NULL
  );
  `,
  // v2: 하루 자산 기록 (오늘 수익, 자산 추이, 수익 캘린더용)
  `
  CREATE TABLE daily_snapshots (
    account_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    total_krw REAL NOT NULL,
    stock_krw REAL NOT NULL,
    cash_krw REAL NOT NULL,
    cash_usd REAL NOT NULL,
    usd_krw REAL NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, day)
  );
  `,
  // v3: 매매일지 (주문마다 이유 메모 + 태그)
  `
  CREATE TABLE journal_notes (
    order_id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // v4: 관심종목 그룹 (시즌과 상관없이 유지)
  `
  CREATE TABLE watch_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE watch_items (
    group_id INTEGER NOT NULL REFERENCES watch_groups(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (group_id, code)
  );
  `,
  // v5: 가격 알림 + 폰 푸시 구독
  `
  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    code TEXT NOT NULL,
    kind TEXT NOT NULL,
    value REAL NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    triggered_at INTEGER,
    triggered_price REAL
  );
  CREATE INDEX alerts_active ON alerts(active, code);
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  // v6: 체결 당시 당일 등락률 (코치의 추격매수 판단용) + 설정
  `
  ALTER TABLE fills ADD COLUMN day_change_rate REAL;
  CREATE TABLE settings (
    user_id INTEGER NOT NULL DEFAULT 1,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
  );
  `,
  // 리플레이 결과
  `
  CREATE TABLE replay_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    scenario_id TEXT NOT NULL,
    codes TEXT NOT NULL DEFAULT '[]',
    start_cash REAL NOT NULL,
    final_value REAL NOT NULL,
    return_rate REAL NOT NULL,
    trade_count INTEGER NOT NULL,
    finished_at INTEGER NOT NULL
  );
  CREATE INDEX replay_results_by_time ON replay_results(user_id, finished_at);
  `,
];

/** DB 열기 + 스키마 맞추기. ':memory:'는 테스트용 */
export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

/** 여러 쓰기를 한 번에 (중간에 실패하면 전부 취소) */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
