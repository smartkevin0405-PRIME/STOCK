import type { DatabaseSync } from 'node:sqlite';
import initSqlJs, { type BindParams, type Database, type SqlValue, type Statement } from 'sql.js';
import { migrate } from '../../../server/src/trading/schema';

// 서버 클래스(TradingRepo·TradingService 등)를 폰/브라우저 안에서 돌리기 위한 어댑터.
// node:sqlite DatabaseSync 중 실제로 쓰는 부분(prepare→get/all/run, exec, close)만 sql.js로 흉내냄

type Row = Record<string, SqlValue>;
type RunResult = { changes: number; lastInsertRowid: number };

/** node:sqlite처럼 위치 인자만 받음. undefined는 null, boolean은 0/1로 */
function toParams(params: unknown[]): BindParams {
  return params.map((p): SqlValue => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'bigint') return Number(p);
    return p as SqlValue;
  });
}

export class LocalStatement {
  constructor(
    private readonly owner: SqlJsDb,
    private readonly sql: string,
  ) {}

  /** 첫 줄 하나 (없으면 undefined) */
  get(...params: unknown[]): Row | undefined {
    return this.owner.withStatement(this.sql, params, (stmt) => (stmt.step() ? stmt.getAsObject() : undefined));
  }

  /** 모든 줄 */
  all(...params: unknown[]): Row[] {
    return this.owner.withStatement(this.sql, params, (stmt) => {
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    });
  }

  /** 쓰기. 바뀐 줄 수 + 마지막 rowid */
  run(...params: unknown[]): RunResult {
    this.owner.withStatement(this.sql, params, (stmt) => {
      while (stmt.step()) {
        // RETURNING 등 결과 줄은 버림
      }
    });
    return this.owner.lastRun();
  }
}

export type LocalDbOptions = {
  /** 저장된 DB 바이트 (없으면 null → 새 DB) */
  load(): Promise<Uint8Array | null>;
  /** DB 바이트 저장 */
  save(bytes: Uint8Array): Promise<void>;
  /** sql-wasm.wasm 위치. 없으면 Vite가 번들한 파일 사용 */
  wasmUrl?: string;
  /** 쓰기 후 저장까지 기다리는 시간 (기본 500ms) */
  saveDelayMs?: number;
};

/** sql.js 위에 올린 node:sqlite 호환 DB. 쓰기가 있으면 잠시 뒤 통째로 저장 */
export class SqlJsDb {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private db: Database,
    private readonly opts: Pick<LocalDbOptions, 'save' | 'saveDelayMs'>,
  ) {
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql: string): LocalStatement {
    return new LocalStatement(this, sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
    if (!/^\s*SELECT\b/i.test(sql)) this.markDirty();
  }

  /** 저장은 안 함. 밀린 저장이 있으면 먼저 await flush() */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.db.close();
  }

  /** 문장 하나 실행 후 바로 free */
  withStatement<T>(sql: string, params: unknown[], fn: (stmt: Statement) => T): T {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(toParams(params));
      return fn(stmt);
    } finally {
      stmt.free();
    }
  }

  lastRun(): RunResult {
    const changes = this.db.getRowsModified();
    const res = this.db.exec('SELECT last_insert_rowid()');
    const lastInsertRowid = Number(res[0]?.values[0]?.[0] ?? 0);
    this.markDirty();
    return { changes, lastInsertRowid };
  }

  /** 지금 DB 바이트 (export 뒤 연결이 새로 열려서 pragma 다시 켬) */
  export(): Uint8Array {
    const bytes = this.db.export();
    this.db.exec('PRAGMA foreign_keys = ON');
    return bytes;
  }

  /** 밀린 저장을 바로 실행 */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.dirty && !this.inTransaction()) {
      this.dirty = false;
      const bytes = this.export();
      // 앞 저장이 실패해도 다음 저장은 진행. 실패하면 다음에 다시 저장
      this.saving = this.saving
        .catch(() => undefined)
        .then(() => this.opts.save(bytes))
        .catch((e: unknown) => {
          this.dirty = true;
          throw e;
        });
    }
    await this.saving;
  }

  /** 서버 클래스에 넘길 때 쓰는 타입 (실제 구현은 이 어댑터) */
  asDatabaseSync(): DatabaseSync {
    return this as unknown as DatabaseSync;
  }

  /** 열린 트랜잭션이 있으면 BEGIN이 실패함 */
  private inTransaction(): boolean {
    try {
      this.db.exec('BEGIN');
    } catch {
      return true;
    }
    this.db.exec('COMMIT');
    return false;
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // 트랜잭션 중이면 다음 기회로 미룸 (export가 DB를 닫았다 열어서 트랜잭션이 날아감)
      if (this.inTransaction()) return this.markDirty();
      this.flush().catch((e: unknown) => console.warn('로컬 DB 저장 실패', e));
    }, this.opts.saveDelayMs ?? 500);
  }
}

/** 로컬 DB 열기: sql.js 준비 → 저장본(없으면 새 DB) → 스키마 맞추기 */
export async function openLocalDb(opts: LocalDbOptions): Promise<SqlJsDb> {
  const wasmUrl = opts.wasmUrl ?? (await import('sql.js/dist/sql-wasm-browser.wasm?url')).default;
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await opts.load();
  const db = new SqlJsDb(new SQL.Database(saved ?? undefined), opts);
  migrate(db.asDatabaseSync());
  return db;
}
