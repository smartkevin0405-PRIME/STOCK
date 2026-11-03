import { describe, expect, it } from 'vitest';
import { openDb } from '../src/trading/db';
import { WatchlistService } from '../src/trading/watchlist';

const make = () => new WatchlistService(openDb(':memory:'), () => 1);

describe('관심종목 그룹', () => {
  it('처음엔 기본 그룹', () => {
    expect(make().list()).toEqual([{ id: 1, name: '관심 종목', codes: ['005930', '000660', 'AAPL', 'NVDA', 'TSLA'] }]);
  });

  it('그룹 추가·이름 변경·종목 추가(중복 무시)·삭제', () => {
    const w = make();
    w.list();
    const g = w.create('  반도체  ');
    expect(g.name).toBe('반도체');
    w.add(g.id, '000660');
    w.add(g.id, '000660');
    w.add(g.id, 'NVDA');
    expect(w.rename(g.id, '반도체 관련').codes).toEqual(['000660', 'NVDA']);
    expect(w.removeCode(g.id, '000660').codes).toEqual(['NVDA']);
    w.remove(g.id);
    expect(w.list()).toHaveLength(1);
  });

  it('순서 변경 = 목록 통째로 교체', () => {
    const w = make();
    const [g] = w.list();
    expect(w.setCodes(g!.id, ['TSLA', '005930', 'TSLA']).codes).toEqual(['TSLA', '005930']);
  });

  it('마지막 그룹은 못 지움, 빈 이름 거부', () => {
    const w = make();
    const [g] = w.list();
    expect(() => w.remove(g!.id)).toThrow('하나는 있어야');
    expect(() => w.create('   ')).toThrow('이름');
    expect(() => w.rename(999, 'x')).toThrow('찾을 수 없어요');
  });
});
