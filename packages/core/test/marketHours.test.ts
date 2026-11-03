import { describe, expect, it } from 'vitest';
import { getMarketStatus, isMarketOpen } from '../src';

const t = (iso: string) => Date.parse(iso);

describe('한국 장 시간 (09:00~15:30 KST)', () => {
  it('평일 장중', () => {
    const s = getMarketStatus('KR', t('2026-11-03T01:00:00Z')); // 화 10:00 KST
    expect(s.state).toBe('open');
    expect(s.closeAt).toBe(t('2026-11-03T06:30:00Z'));
  });

  it('개장 직전/직후 경계', () => {
    expect(isMarketOpen('KR', t('2026-11-02T23:59:00Z'))).toBe(false); // 08:59
    expect(isMarketOpen('KR', t('2026-11-03T00:00:00Z'))).toBe(true); // 09:00
    expect(isMarketOpen('KR', t('2026-11-03T06:29:00Z'))).toBe(true); // 15:29
    expect(isMarketOpen('KR', t('2026-11-03T06:30:00Z'))).toBe(false); // 15:30
  });

  it('장 마감 후에는 다음 날 개장', () => {
    const s = getMarketStatus('KR', t('2026-11-03T07:00:00Z'));
    expect(s.state).toBe('closed');
    expect(s.nextOpen).toBe(t('2026-11-04T00:00:00Z'));
  });

  it('금요일 장 마감 후에는 월요일 개장', () => {
    expect(getMarketStatus('KR', t('2026-11-06T07:00:00Z')).nextOpen).toBe(t('2026-11-09T00:00:00Z'));
  });

  it('휴장일 건너뛰기 (성탄절 → 주말 → 월요일)', () => {
    expect(getMarketStatus('KR', t('2026-12-24T07:00:00Z')).nextOpen).toBe(t('2026-12-28T00:00:00Z'));
    expect(isMarketOpen('KR', t('2026-12-25T01:00:00Z'))).toBe(false);
  });
});

describe('미국 장 시간 (09:30~16:00 뉴욕, 서머타임 자동)', () => {
  it('겨울(EST): 한국시간 23:30 개장', () => {
    expect(isMarketOpen('US', t('2026-11-03T14:30:00Z'))).toBe(true);
    expect(isMarketOpen('US', t('2026-11-03T14:29:00Z'))).toBe(false);
    expect(getMarketStatus('US', t('2026-11-03T15:00:00Z')).closeAt).toBe(t('2026-11-03T21:00:00Z'));
  });

  it('여름(EDT): 한국시간 22:30 개장', () => {
    expect(isMarketOpen('US', t('2026-07-01T13:30:00Z'))).toBe(true);
    expect(getMarketStatus('US', t('2026-07-01T13:29:00Z')).nextOpen).toBe(t('2026-07-01T13:30:00Z'));
  });

  it('서머타임 시작 주말을 넘어가는 다음 개장', () => {
    // 2026-03-06(금) 장 마감 후 → 03-08 서머타임 시작 → 03-09(월) 09:30 EDT
    expect(getMarketStatus('US', t('2026-03-06T21:30:00Z')).nextOpen).toBe(t('2026-03-09T13:30:00Z'));
  });

  it('추수감사절 휴장', () => {
    const s = getMarketStatus('US', t('2026-11-26T15:00:00Z'));
    expect(s.state).toBe('closed');
    expect(s.nextOpen).toBe(t('2026-11-27T14:30:00Z'));
  });
});
