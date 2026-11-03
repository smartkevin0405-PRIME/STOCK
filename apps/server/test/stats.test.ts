import { describe, expect, it } from 'vitest';
import { openDb } from '../src/trading/db';
import { TradingService } from '../src/trading/service';
import { StatsService, periodStart } from '../src/trading/stats';
import { KR_OPEN, TestProvider } from './helpers';

function setup(start = KR_OPEN) {
  let now = start;
  const provider = new TestProvider();
  const trading = new TradingService({ db: openDb(':memory:'), provider, now: () => now });
  const stats = new StatsService(trading, provider, () => now);
  return { trading, stats, provider, setNow: (t: number) => (now = t) };
}

describe('기간 시작 (한국시간)', () => {
  it('이번 주 월요일 0시, 이번 달 1일 0시', () => {
    const now = Date.parse('2026-11-05T03:00:00Z'); // 11/5(목) 12:00 KST
    expect(periodStart('week', now)).toBe(Date.parse('2026-11-01T15:00:00Z')); // 11/2(월) 0시 KST
    expect(periodStart('month', now)).toBe(Date.parse('2026-10-31T15:00:00Z')); // 11/1 0시 KST
    expect(periodStart('all', now)).toBeUndefined();
  });
});

describe('통계', () => {
  it('매수·매도 → 승률, 체결 당시 등락률 기록', async () => {
    const { trading, stats, provider } = setup();
    provider.prices.set('005930', 73_500); // 전일 대비 +5%
    await trading.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 10, limitPrice: 73_500 });
    expect(trading.fills()[0]?.dayChangeRate).toBeCloseTo(0.05);

    provider.prices.set('005930', 80_000);
    await trading.placeOrder({ code: '005930', side: 'sell', type: 'limit', qty: 10, limitPrice: 80_000 });

    const s = await stats.stats('all');
    expect(s.trades.count).toBe(1);
    expect(s.trades.wins).toBe(1);
    expect(s.equity[s.equity.length - 1]?.day).toBe('now');
    expect(s.calendar).toHaveLength(1);
    expect(s.calendar[0]?.pnlKrw).toBe(s.equity[s.equity.length - 1]!.totalKrw - 10_000_000);
  });

  it('미국주식 양도세 예상: 250만원 공제 후 22%', async () => {
    const { trading, stats, provider } = setup(Date.parse('2026-11-03T15:00:00Z')); // 미국 장중
    await trading.exchange('KRW', 5_000_000);
    provider.prices.set('AAPL', 200);
    await trading.placeOrder({ code: 'AAPL', side: 'buy', type: 'limit', qty: 15, limitPrice: 200 });
    provider.prices.set('AAPL', 400);
    await trading.placeOrder({ code: 'AAPL', side: 'sell', type: 'limit', qty: 15, limitPrice: 400 });
    const { tax } = await stats.stats('all');
    expect(tax.usRealizedKrw).toBeGreaterThan(2_500_000);
    expect(tax.estimatedTaxKrw).toBe(Math.round((tax.usRealizedKrw - 2_500_000) * 0.22));
  });

  it('환전 평균 단가 (환율 변동 손익용)', async () => {
    const { trading } = setup();
    await trading.exchange('KRW', 1_414_000); // 1,414원에 $1,000
    expect(trading.view().avgUsdRate).toBeCloseTo(1_414);
    await trading.exchange('USD', 500); // 절반 팔아도 평균은 그대로
    expect(trading.view().avgUsdRate).toBeCloseTo(1_414);
  });
});

describe('코치', () => {
  it('손절 기준 설정이 코치에 반영 + 집중도', async () => {
    const { trading, stats, provider } = setup();
    trading.repo.setSetting('stopLossRate', '-0.05');
    await trading.placeOrder({ code: '005930', side: 'buy', type: 'limit', qty: 100, limitPrice: 70_000 });
    provider.prices.set('005930', 70_000);
    const c = await stats.coach();
    expect(c.stopLossRate).toBe(-0.05);
    expect(c.concentration).toMatchObject({ code: '005930', triggered: true });
    expect(c.report.disclaimer).toContain('투자 조언이 아니에요');
  });
});
