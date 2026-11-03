import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradingRepo } from '../../server/src/trading/repo';
import { transaction } from '../../server/src/trading/schema';
import { TradingService } from '../../server/src/trading/service';
import { WatchlistService } from '../../server/src/trading/watchlist';
import { KR_OPEN, TestProvider } from '../../server/test/helpers';
import { memoryStore } from '../src/local/idb';
import { openLocalDb, type SqlJsDb } from '../src/local/sqlDb';

// 노드에서는 node_modules의 wasm 파일을 바로 읽음
const wasmUrl = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');

const opened: SqlJsDb[] = [];
async function open(store = memoryStore(), saveDelayMs?: number) {
  const db = await openLocalDb({ ...store, wasmUrl, saveDelayMs });
  opened.push(db);
  return db;
}

afterEach(() => {
  vi.useRealTimers();
  for (const db of opened.splice(0)) db.close();
});

describe('sql.js 어댑터 (node:sqlite 흉내)', () => {
  it('스키마 최신 버전 + foreign_keys 켜짐', async () => {
    const db = await open();
    const v = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(v.user_version).toBeGreaterThanOrEqual(10);
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });

  it('get은 없으면 undefined, all은 평범한 객체 배열, run은 changes·lastInsertRowid', async () => {
    const db = await open();
    expect(db.prepare('SELECT * FROM settings WHERE key = ?').get('없음')).toBeUndefined();
    const a = db.prepare('INSERT INTO watch_groups (user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)').run(1, 'A', 0, 1);
    const b = db.prepare('INSERT INTO watch_groups (user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?)').run(1, 'B', 1, 2);
    expect(a).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(b).toEqual({ changes: 1, lastInsertRowid: 2 });
    expect(db.prepare('SELECT id, name FROM watch_groups ORDER BY id').all()).toEqual([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);
    expect(db.prepare('UPDATE watch_groups SET name = ?').run('C').changes).toBe(2);
    // undefined → null
    db.prepare('INSERT INTO alerts (user_id, code, kind, value, created_at, triggered_at) VALUES (?, ?, ?, ?, ?, ?)').run(1, 'X', 'above', 1, 1, undefined);
    expect(db.prepare('SELECT triggered_at FROM alerts').get()).toEqual({ triggered_at: null });
  });

  it('transaction 중간에 실패하면 전부 취소', async () => {
    const db = await open();
    const raw = db.asDatabaseSync();
    expect(() =>
      transaction(raw, () => {
        raw.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)').run(1, 'a', '1');
        raw.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)').run(1, 'a', '2'); // PK 충돌
      }),
    ).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
  });

  it('TradingService: 계좌 만들고 시장가 매수 → 체결', async () => {
    const db = await open();
    const svc = new TradingService({ db: db.asDatabaseSync(), provider: new TestProvider(), now: () => KR_OPEN });
    expect(svc.view()).toMatchObject({ season: 1, cash: { KRW: 10_000_000, USD: 0 } });
    const { order, fill } = await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 10 });
    expect(order.status).toBe('filled');
    expect(fill).toMatchObject({ id: 1, price: 70_100, qty: 10, amount: 701_000, commission: 105 });
    expect(svc.view().cash.KRW).toBe(10_000_000 - 701_105);
    expect(svc.view().positions).toEqual([{ code: '005930', qty: 10, avgPrice: 70_100, currency: 'KRW' }]);
    const repo = new TradingRepo(db.asDatabaseSync());
    expect(repo.activeAccount()?.id).toBe(1);
    expect(svc.fills()).toHaveLength(1);
  });

  it('저장 → 다시 열기 → 데이터 그대로 (+ foreign_keys 다시 켜짐)', async () => {
    const store = memoryStore();
    const db = await open(store);
    const svc = new TradingService({ db: db.asDatabaseSync(), provider: new TestProvider(), now: () => KR_OPEN });
    await svc.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 3 });
    new WatchlistService(db.asDatabaseSync(), () => KR_OPEN).list();
    await db.flush();
    expect(await store.load()).toBeInstanceOf(Uint8Array);
    // export 후에도 같은 연결로 계속 쓸 수 있고 pragma 유지
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });

    const again = await open(store);
    const svc2 = new TradingService({ db: again.asDatabaseSync(), provider: new TestProvider(), now: () => KR_OPEN });
    expect(svc2.view().positions).toEqual([{ code: '005930', qty: 3, avgPrice: 70_100, currency: 'KRW' }]);
    expect(new WatchlistService(again.asDatabaseSync()).list()[0]?.codes).toContain('005930');
    // ON DELETE CASCADE 동작
    again.prepare('DELETE FROM watch_groups').run();
    expect(again.prepare('SELECT COUNT(*) AS n FROM watch_items').get()).toEqual({ n: 0 });
  });

  it('저장이 실패하면 다음 flush에서 다시 저장', async () => {
    const store = memoryStore();
    const save = vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('꽉 참'));
    const db = await open(store);
    db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)').run(1, 'k', 'v');
    await expect(db.flush()).rejects.toThrow('꽉 참');
    await db.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(await store.load()).toBeInstanceOf(Uint8Array);
  });

  it('쓰기 후 잠시 뒤 자동 저장 (트랜잭션 끝난 뒤)', async () => {
    vi.useFakeTimers();
    const store = memoryStore();
    const save = vi.spyOn(store, 'save');
    const db = await open(store, 500);
    await vi.advanceTimersByTimeAsync(1_000);
    save.mockClear();

    db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)').run(1, 'k', 'v');
    db.prepare('SELECT * FROM settings').all();
    await vi.advanceTimersByTimeAsync(400);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(1);

    db.exec('BEGIN');
    db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)').run(1, 'k2', 'v');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(1); // 트랜잭션 중엔 저장 안 함
    db.exec('COMMIT');
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 2 });
  });
});
