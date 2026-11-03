import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StockInfo } from '@stock/shared';
import { describe, expect, it } from 'vitest';
import { StockDirectory } from '../src/market/directory';
import { fileStorage } from '../src/market/fileStorage';
import { DirectoryStore } from '../src/market/directoryStore';

const s = (code: string): StockInfo => ({ code, market: 'KR', exchange: 'KOSPI', nameKo: code, nameEn: '', currency: 'KRW' });

describe('종목 목록 저장', () => {
  it('받아서 파일에 저장 → 다음 실행 때 파일에서 바로 읽음', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'stocks-')), 'stocks.json');
    const dir1 = new StockDirectory();
    const store1 = new DirectoryStore({ directory: dir1, storage: fileStorage(file), fetchAll: async () => [s('A'), s('B')], now: () => 1_000 });
    await store1.refresh();
    expect(dir1.list()).toHaveLength(2);
    expect(JSON.parse(readFileSync(file, 'utf8')).updatedAt).toBe(1_000);

    const dir2 = new StockDirectory();
    const store2 = new DirectoryStore({ directory: dir2, storage: fileStorage(file), fetchAll: async () => [], now: () => 2_000 });
    await store2.load();
    expect(dir2.get('B')).toBeDefined();
    expect(store2.isStale()).toBe(false);
  });

  it('너무 적게 받으면 기존 목록 유지', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'stocks-')), 'stocks.json');
    const dir = new StockDirectory([s('A'), s('B')]);
    const store = new DirectoryStore({ directory: dir, storage: fileStorage(file), fetchAll: async () => [s('X')], minCount: 2 });
    await expect(store.refresh()).rejects.toThrow('너무 적어요');
    expect(dir.list().map((x) => x.code)).toEqual(['A', 'B']);
  });
});
