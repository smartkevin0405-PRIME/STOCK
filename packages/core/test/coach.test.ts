import { describe, expect, it } from 'vitest';
import {
  checkAveragingDown,
  checkChasing,
  checkOvertrading,
  checkStopLoss,
  checkTimeOfDay,
  closedBuyLots,
  krwShort,
  pct,
  runCoach,
} from '../src/coach';
import type { CoachFill } from '../src/coach';

// 2026-11-02(월) 기준. 한국 09:00 KST = 00:00Z
const KST = (day: number, hhmm: string) => Date.parse(`2026-11-${String(2 + day).padStart(2, '0')}T${hhmm}:00+09:00`);

let seq = 0;
function f(side: CoachFill['side'], price: number, qty: number, at: number, extra: Partial<CoachFill> = {}): CoachFill {
  const code = extra.code ?? '005930';
  return {
    orderId: `o${++seq}`,
    code,
    side,
    price,
    qty,
    amount: price * qty,
    commission: 0,
    tax: 0,
    currency: code === 'AAPL' ? 'USD' : 'KRW',
    executedAt: at,
    ...extra,
  };
}

/** 같은 종목을 사고 다음 날 파는 거래 한 건 */
function roundTrip(code: string, buyPrice: number, sellPrice: number, day: number, buyAt = '10:00', extra: Partial<CoachFill> = {}) {
  return [f('buy', buyPrice, 1, KST(day, buyAt), { code, ...extra }), f('sell', sellPrice, 1, KST(day + 1, '11:00'), { code })];
}

describe('도우미', () => {
  it('퍼센트·금액 표시', () => {
    expect(pct(0.123)).toBe('12%');
    expect(pct(0.05, true)).toBe('+5%');
    expect(pct(-0.12, true)).toBe('-12%');
    expect(krwShort(42_000)).toBe('4.2만원');
    expect(krwShort(30_000)).toBe('3만원');
    expect(krwShort(3_500)).toBe('3,500원');
  });

  it('매수 건별 결과 (FIFO, 수수료·세금 수량 비례)', () => {
    const lots = closedBuyLots([
      f('buy', 100, 10, KST(0, '10:00'), { commission: 10 }),
      f('buy', 200, 10, KST(0, '11:00')),
      f('sell', 150, 15, KST(1, '10:00'), { commission: 15, tax: 15 }),
    ]);
    // 첫 매수만 다 팔림: (150-100)*10 - 10 - 30*(10/15)
    expect(lots).toHaveLength(1);
    expect(lots[0]!.pnl).toBeCloseTo(500 - 10 - 20);
    expect(lots[0]!.pnlRate).toBeCloseTo(470 / 1000);
  });
});

describe('추격매수', () => {
  it('+5% 이상 오른 뒤 산 거래의 손실 비율', () => {
    const fills = [
      ...roundTrip('A', 100, 90, 0, '10:00', { dayChangeRate: 0.08 }),
      ...roundTrip('B', 100, 95, 0, '10:00', { dayChangeRate: 0.05 }),
      ...roundTrip('C', 100, 110, 0, '10:00', { dayChangeRate: 0.12 }),
      ...roundTrip('D', 100, 80, 0, '10:00', { dayChangeRate: 0.06 }),
      ...roundTrip('E', 100, 80, 0, '10:00', { dayChangeRate: 0.01 }), // 추격 아님
      f('buy', 100, 1, KST(3, '10:00'), { code: 'F', dayChangeRate: 0.2 }), // 아직 보유 중
    ];
    const r = checkChasing(fills)!;
    expect(r.triggered).toBe(true);
    expect(r.data).toMatchObject({ count: 5, closed: 4, losses: 3, lossRate: 0.75 });
    expect(r.message).toBe('당일 +5% 이상 오른 뒤 산 거래 5건, 결과가 나온 4건 중 3건 손실');
  });

  it('표본이 적거나 대부분 수익이면 경고 안 함', () => {
    expect(checkChasing(roundTrip('A', 100, 90, 0, '10:00', { dayChangeRate: 0.1 }))!.triggered).toBe(false);
    const wins = [0, 1, 2].flatMap((d) => roundTrip('A', 100, 120, d * 2, '10:00', { dayChangeRate: 0.1 }));
    expect(checkChasing(wins)!.triggered).toBe(false);
  });

  it('추격매수가 없거나 등락률 정보가 없으면 null', () => {
    expect(checkChasing(roundTrip('A', 100, 90, 0))).toBeNull();
  });
});

describe('손절 미준수', () => {
  const fills = [
    ...roundTrip('A', 100, 88, 0), // -12% 미준수
    ...roundTrip('B', 100, 80, 0), // -20% 미준수
    ...roundTrip('C', 100, 94, 0), // -6% (여유 2%p 안)
    ...roundTrip('D', 100, 120, 0),
  ];

  it('손절선보다 더 떨어진 뒤 판 거래', () => {
    const r = checkStopLoss(fills, { stopLossRate: -0.05 })!;
    expect(r.triggered).toBe(true);
    expect(r.data).toMatchObject({ closed: 4, violations: 2, worstRate: expect.closeTo(-0.2) });
    expect(r.data.avgViolationRate).toBeCloseTo(-0.16);
    expect(r.message).toBe('-5% 손절 정해놓고 평균 -16%까지 버틴 거래 2건 (최대 -20%)');
  });

  it('모두 지켰으면 칭찬', () => {
    const r = checkStopLoss(roundTrip('C', 100, 94, 0), { stopLossRate: -0.05 })!;
    expect(r.triggered).toBe(false);
    expect(r.message).toBe('-5% 손절 원칙을 1건 모두 지켰어요');
  });

  it('손절 원칙을 정하지 않았거나 청산 거래가 없으면 null', () => {
    expect(checkStopLoss(fills)).toBeNull();
    expect(checkStopLoss([f('buy', 100, 1, KST(0, '10:00'))], { stopLossRate: -0.05 })).toBeNull();
  });
});

describe('물타기', () => {
  // 손실 중 추가매수 → 결국 손절
  const averaged = (code: string, day: number, sell: number) => [
    f('buy', 100, 10, KST(day, '10:00'), { code }),
    f('buy', 90, 10, KST(day, '11:00'), { code }), // 평균단가 100보다 낮게 추가매수
    f('sell', sell, 20, KST(day + 1, '10:00'), { code }),
  ];

  it('손실 중 추가매수한 종목의 평균 수익률', () => {
    const fills = [
      ...averaged('A', 0, 85), // (1700-1900)/1900
      ...averaged('B', 2, 80), // (1600-1900)/1900
      ...averaged('C', 4, 95), // 0
      ...roundTrip('D', 100, 110, 0), // 물타기 없음 +10%
      f('buy', 100, 1, KST(0, '10:00'), { code: 'E' }),
      f('buy', 110, 1, KST(0, '11:00'), { code: 'E' }), // 불타기 (오를 때 추가매수) → 물타기 아님
    ];
    const r = checkAveragingDown(fills)!;
    expect(r.triggered).toBe(true);
    expect(r.data).toMatchObject({ buys: 3, closedCycles: 3 });
    expect(r.data.avgReturn).toBeCloseTo((-200 / 1900 - 300 / 1900 + 0) / 3);
    expect(r.data.otherAvgReturn).toBeCloseTo(0.1);
    expect(r.message).toBe('손실 중 추가매수한 종목 평균 수익률 -9%, 그 외 종목 +10%');
  });

  it('아직 다 안 팔았으면 횟수만', () => {
    const r = checkAveragingDown(averaged('A', 0, 85).slice(0, 2))!;
    expect(r.triggered).toBe(false);
    expect(r.message).toBe('손실 중 추가매수 1회 (아직 다 판 종목 없음)');
  });

  it('물타기가 없으면 null', () => {
    expect(checkAveragingDown(roundTrip('A', 100, 90, 0))).toBeNull();
  });
});

describe('과매매', () => {
  it('매매한 날 하루 평균 횟수와 수수료·세금', () => {
    const fills: CoachFill[] = [];
    for (let i = 0; i < 15; i++) fills.push(f('buy', 1000, 1, KST(0, `10:${String(i).padStart(2, '0')}`), { code: `S${i}`, commission: 1000 }));
    for (let i = 0; i < 15; i++) fills.push(f('sell', 1000, 1, KST(1, `10:${String(i).padStart(2, '0')}`), { code: `S${i}`, commission: 1000, tax: 800 }));
    const r = checkOvertrading(fills)!;
    expect(r.triggered).toBe(true);
    expect(r.data).toMatchObject({ fills: 30, activeDays: 2, avgPerDay: 15, maxPerDay: 15, totalCostKrw: 42_000 });
    expect(r.message).toBe('매매한 날 하루 평균 15회 매매, 수수료·세금으로 총 4.2만원 지출');
  });

  it('미국 주식은 뉴욕 날짜 기준, 달러 비용은 원화 환산', () => {
    // 뉴욕 11/2 장중 두 번 (한국 날짜로는 11/2 밤, 11/3 새벽)
    const fills = [
      f('buy', 100, 1, Date.parse('2026-11-02T10:00:00-05:00'), { code: 'AAPL', commission: 0.25 }),
      f('sell', 100, 1, Date.parse('2026-11-02T15:00:00-05:00'), { code: 'AAPL', commission: 0.25 }),
    ];
    const r = checkOvertrading(fills, { usdKrw: 1400 })!;
    expect(r.data).toMatchObject({ activeDays: 1, avgPerDay: 2, totalCostKrw: 700 });
    expect(r.triggered).toBe(false);
    expect(() => checkOvertrading(fills)).toThrow(/환율/);
  });

  it('체결이 없으면 null', () => {
    expect(checkOvertrading([])).toBeNull();
  });
});

describe('시간대별 승률', () => {
  it('장 시작 10분 내 매수 승률이 낮으면 경고', () => {
    const fills = [
      // 09:00~09:09 매수: 1승 3패
      ...roundTrip('A', 100, 110, 0, '09:00'),
      ...roundTrip('B', 100, 90, 0, '09:03'),
      ...roundTrip('C', 100, 90, 0, '09:05'),
      ...roundTrip('D', 100, 90, 0, '09:09'),
      // 장중: 3승 1패
      ...roundTrip('E', 100, 110, 0, '09:10'),
      ...roundTrip('F', 100, 110, 0, '11:00'),
      ...roundTrip('G', 100, 110, 0, '13:00'),
      ...roundTrip('H', 100, 90, 0, '14:00'),
      // 마감 전 30분: 1승
      ...roundTrip('I', 100, 110, 0, '15:00'),
    ];
    const r = checkTimeOfDay(fills)!;
    expect(r.triggered).toBe(true);
    expect(r.data.open).toMatchObject({ count: 4, wins: 1, winRate: 0.25 });
    expect(r.data.rest).toMatchObject({ count: 5, wins: 4, winRate: 0.8 });
    expect(r.data.buckets.map((b) => [b.bucket, b.count])).toEqual([['open', 4], ['mid', 4], ['close', 1]]);
    expect(r.message).toBe('장 시작 10분 내 매수 승률 25%, 나머지 시간 80%');
  });

  it('미국은 뉴욕 09:30 기준', () => {
    const at = (iso: string) => Date.parse(iso);
    const fills = [
      f('buy', 100, 1, at('2026-11-02T09:35:00-05:00'), { code: 'AAPL' }),
      f('sell', 110, 1, at('2026-11-03T10:00:00-05:00'), { code: 'AAPL' }),
    ];
    const r = checkTimeOfDay(fills)!;
    expect(r.data.open.count).toBe(1);
    expect(r.triggered).toBe(false); // 표본 부족
  });

  it('표본이 부족하면 경고 안 함', () => {
    const r = checkTimeOfDay([...roundTrip('A', 100, 90, 0, '09:01'), ...roundTrip('B', 100, 110, 0, '11:00')])!;
    expect(r.triggered).toBe(false);
  });

  it('결과가 나온 매수가 없으면 null', () => {
    expect(checkTimeOfDay([f('buy', 100, 1, KST(0, '09:01'))])).toBeNull();
  });
});

describe('코치 리포트', () => {
  it('경고 항목이 먼저, 데이터 부족한 규칙은 빠짐, 고지 문구 포함', () => {
    const fills = [
      ...roundTrip('A', 100, 70, 0),
      ...roundTrip('B', 100, 110, 2),
    ];
    const report = runCoach(fills, { stopLossRate: -0.05 });
    expect(report.findings.map((x) => x.rule)).toEqual(['stopLoss', 'overtrading', 'timeOfDay']);
    expect(report.findings[0]!.triggered).toBe(true);
    expect(report.disclaimer).toContain('투자 조언이 아니에요');
  });

  it('빈 기록이면 항목 없음', () => {
    expect(runCoach([]).findings).toEqual([]);
  });
});
