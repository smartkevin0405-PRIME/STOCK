import { describe, expect, it } from 'vitest';
import { isValidTick, priceLimits, roundToTick, tickSize } from '../src';

describe('호가단위', () => {
  it.each([
    [1_999, 1], [2_000, 5], [4_999, 5], [5_000, 10], [19_990, 10], [20_000, 50],
    [49_950, 50], [50_000, 100], [199_900, 100], [200_000, 500], [499_500, 500], [500_000, 1_000],
  ])('국내 %d원 → %d원 단위', (price, tick) => {
    expect(tickSize('KR', price)).toBe(tick);
  });

  it('미국은 $1 이상 1센트, 미만 0.01센트', () => {
    expect(tickSize('US', 150)).toBe(0.01);
    expect(tickSize('US', 0.5)).toBe(0.0001);
  });

  it('호가단위로 맞추기', () => {
    expect(roundToTick('KR', 52_345, 'down')).toBe(52_300);
    expect(roundToTick('KR', 52_345, 'up')).toBe(52_400);
    expect(roundToTick('KR', 4_998, 'up')).toBe(5_000);
    expect(roundToTick('US', 12.345, 'nearest')).toBe(12.35);
    expect(roundToTick('US', 0.123456, 'down')).toBe(0.1234);
  });

  it('호가단위 검사', () => {
    expect(isValidTick('KR', 70_000)).toBe(true);
    expect(isValidTick('KR', 70_050)).toBe(false);
    expect(isValidTick('US', 187.23)).toBe(true);
    expect(isValidTick('US', 187.235)).toBe(false);
    expect(isValidTick('KR', 0)).toBe(false);
  });
});

describe('가격제한폭', () => {
  it('전일 종가 ±30%, 호가단위로 안쪽 맞춤', () => {
    expect(priceLimits('KR', 72_000)).toEqual({ upper: 93_600, lower: 50_400 });
    expect(priceLimits('KR', 1_234)).toEqual({ upper: 1_604, lower: 864 });
  });

  it('미국은 제한 없음', () => {
    expect(priceLimits('US', 100)).toBeNull();
  });
});
