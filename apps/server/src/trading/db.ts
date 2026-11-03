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
