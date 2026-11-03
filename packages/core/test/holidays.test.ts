import { describe, expect, it } from 'vitest';
import { HOLIDAYS } from '../src/holidays';
import { isTradingDay } from '../src/marketHours';

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const trading = (market: 'KR' | 'US', d: string) => {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  return isTradingDay(market, y, m, dd);
};

describe('휴장일 목록 형식', () => {
  for (const market of ['KR', 'US'] as const) {
    it(`${market}: 전부 평일이고 날짜 형식이 맞음`, () => {
      for (const d of HOLIDAYS[market]) {
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(Number.isNaN(Date.parse(d))).toBe(false);
        expect([0, 6]).not.toContain(weekday(d));
      }
    });

    it(`${market}: 2026·2027년 모두 들어 있음`, () => {
      const years = new Set([...HOLIDAYS[market]].map((d) => d.slice(0, 4)));
      expect(years).toEqual(new Set(['2026', '2027']));
    });
  }

  it('연도별 휴장일 수', () => {
    const count = (market: 'KR' | 'US', y: string) => [...HOLIDAYS[market]].filter((d) => d.startsWith(y)).length;
    expect(count('KR', '2026')).toBe(17);
    expect(count('KR', '2027')).toBe(16);
    expect(count('US', '2026')).toBe(10);
    expect(count('US', '2027')).toBe(10);
  });
});

describe('한국 휴장일', () => {
  it('2026 제헌절(7/17) 공휴일 재지정 → 휴장', () => {
    expect(trading('KR', '2026-07-17')).toBe(false);
  });

  it('2027 설날: 주말 겹침 → 월·화 휴장', () => {
    expect(trading('KR', '2027-02-05')).toBe(true);
    expect(trading('KR', '2027-02-08')).toBe(false);
    expect(trading('KR', '2027-02-09')).toBe(false);
    expect(trading('KR', '2027-02-10')).toBe(true);
  });

  it('2027 토·일 공휴일 → 다음 월요일 대체공휴일', () => {
    for (const d of ['2027-05-03', '2027-07-19', '2027-08-16', '2027-10-04', '2027-10-11', '2027-12-27']) {
      expect(trading('KR', d), d).toBe(false);
    }
  });

  it('2027 현충일(6/6 일)은 대체공휴일 없음', () => {
    expect(trading('KR', '2027-06-07')).toBe(true);
  });

  it('연말 휴장', () => {
    expect(trading('KR', '2026-12-31')).toBe(false);
    expect(trading('KR', '2027-12-31')).toBe(false);
    expect(trading('KR', '2027-12-30')).toBe(true);
  });
});

describe('미국 휴장일', () => {
  it('토요일 공휴일은 금요일, 일요일 공휴일은 월요일에 쉼', () => {
    expect(trading('US', '2026-07-03')).toBe(false);
    expect(trading('US', '2027-06-18')).toBe(false);
    expect(trading('US', '2027-07-05')).toBe(false);
    expect(trading('US', '2027-12-24')).toBe(false);
  });

  it('2028 신정이 토요일이어도 2027-12-31은 개장', () => {
    expect(trading('US', '2027-12-31')).toBe(true);
  });

  it('반일장은 정규장으로 취급', () => {
    expect(trading('US', '2026-11-27')).toBe(true);
    expect(trading('US', '2026-12-24')).toBe(true);
  });
});
