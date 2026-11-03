import type { AchievementUnlock, ServerMessage } from '@stock/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { AchievementService, keptStopLoss, monthRange } from '../src/trading/achievements';
import { AlertService } from '../src/trading/alerts';
import { openDb } from '../src/trading/db';
import { TradingService } from '../src/trading/service';
import { WatchlistService } from '../src/trading/watchlist';
import { KR_OPEN, TestProvider } from './helpers';

const US_OPEN = Date.parse('2026-11-03T15:00:00Z'); // 뉴욕 10:00

function setup(start = KR_OPEN) {
  let now = start;
  const db = openDb(':memory:');
  const provider = new TestProvider();
  const trading = new TradingService({ db, provider, now: () => now });
  const ach = new AchievementService({ trading, now: () => now });
  const unlocked: AchievementUnlock[] = [];
  ach.onUnlock((u) => unlocked.push(u));
  const ids = () => unlocked.map((u) => u.id);
  const buy = (qty = 1, code = '005930') => trading.placeOrder({ code, side: 'buy', type: 'market', qty });
  const sell = (qty = 1, code = '005930') => trading.placeOrder({ code, side: 'sell', type: 'market', qty });
  return { db, provider, trading, ach, unlocked, ids, buy, sell, setNow: (t: number) => (now = t) };
}

describe('손절 원칙 판단', () => {
  it('손절선 -2%p ~ +1%p 사이 손실 매도만 인정', () => {
    expect(keptStopLoss(-0.05, -0.05)).toBe(true);
    expect(keptStopLoss(-0.07, -0.05)).toBe(true);
    expect(keptStopLoss(-0.04, -0.05)).toBe(true);
    expect(keptStopLoss(-0.03, -0.05)).toBe(false);
    expect(keptStopLoss(-0.08, -0.05)).toBe(false);
    expect(keptStopLoss(0, -0.01)).toBe(false);
  });

  it('이번 달 범위는 한국시간 기준', () => {
    // 10월 31일 23:30 KST
    const r = monthRange(Date.parse('2026-10-31T14:30:00Z'));
    expect(r.month).toBe('2026-10');
    expect(r.start).toBe(Date.parse('2026-09-30T15:00:00Z'));
    expect(r.end).toBe(Date.parse('2026-10-31T15:00:00Z'));
    expect(monthRange(Date.parse('2026-10-31T15:00:00Z')).month).toBe('2026-11');
  });
});

describe('업적', () => {
  it('처음엔 전부 잠김, 챌린지 4개', async () => {
    const { ach, unlocked } = setup();
    const v = await ach.view();
    expect(v.achievements).toHaveLength(12);
    expect(v.achievements.every((a) => a.unlockedAt === undefined)).toBe(true);
    expect(v.challenges.map((c) => c.id)).toEqual(['profit5', 'stopLoss10', 'mdd10', 'journal10']);
    expect(v.challenges.find((c) => c.id === 'stopLoss10')).toMatchObject({ status: 'needsSetting', hint: expect.any(String), progress: 0 });
    expect(v.challenges.find((c) => c.id === 'mdd10')).toMatchObject({ status: 'active', month: '2026-11' });
    expect(unlocked).toEqual([]);
  });

  it('첫 매수 → 첫 익절 → 3연승 (매매 이벤트로 자동 확인)', async () => {
    const { ach, provider, buy, sell, ids, unlocked } = setup();
    const stop = ach.start();
    await buy();
    await ach.check(); // 이벤트로 시작된 확인이 끝날 때까지
    expect(ids()).toEqual(['firstBuy']);
    expect(unlocked[0]).toMatchObject({ kind: 'achievement', title: '첫 매수', icon: '🛒', unlockedAt: KR_OPEN });

    for (let i = 0; i < 3; i++) {
      provider.prices.set('005930', 70_000 + 2_000 * i);
      if (i > 0) await buy();
      provider.prices.set('005930', 75_000 + 2_000 * i);
      await sell();
    }
    await ach.check();
    expect(ids()).toEqual(['firstBuy', 'firstProfit', 'winStreak3']);

    const v = await ach.view();
    expect(v.achievements.find((a) => a.id === 'winStreak10')).toMatchObject({ progress: 0.3 });
    expect(v.achievements.find((a) => a.id === 'firstBuy')?.unlockedAt).toBe(KR_OPEN);
    stop();
  });

  it('손실 매도는 연승을 끊음', async () => {
    const { ach, provider, buy, sell } = setup();
    for (const [buyAt, sellAt] of [
      [70_000, 75_000],
      [70_000, 75_000],
      [70_000, 65_000],
      [70_000, 75_000],
    ]) {
      provider.prices.set('005930', buyAt!);
      await buy();
      provider.prices.set('005930', sellAt!);
      await sell();
    }
    await ach.check();
    expect(ach.facts().maxWinStreak).toBe(2);
    expect((await ach.view()).achievements.find((a) => a.id === 'winStreak3')?.unlockedAt).toBeUndefined();
  });

  it('첫 환전 + 미국주식 데뷔', async () => {
    const { ach, trading, ids, setNow } = setup(US_OPEN);
    await trading.exchange('KRW', 1_000_000);
    await ach.check();
    expect(ids()).toEqual(['firstFx']);
    setNow(US_OPEN);
    await trading.placeOrder({ code: 'AAPL', side: 'buy', type: 'market', qty: 1 });
    await ach.check();
    expect(ids()).toEqual(['firstFx', 'firstBuy', 'usDebut']);
  });

  it('손절 원칙: 기준 근처 손절만 업적·챌린지에 셈', async () => {
    const { ach, trading, provider, buy, sell, ids } = setup();
    trading.repo.setSetting('stopLossRate', '-0.05');
    await buy(3);
    provider.prices.set('005930', 63_000); // -10%: 너무 늦게 손절
    await sell();
    await ach.check();
    expect(ids()).not.toContain('stopLossKept');

    provider.prices.set('005930', 66_500); // -5%
    await sell();
    await ach.check();
    expect(ids()).toContain('stopLossKept');
    const c = (await ach.view()).challenges.find((x) => x.id === 'stopLoss10')!;
    expect(c).toMatchObject({ status: 'active', value: 1, target: 10, progress: 0.1 });
    expect(c.hint).toBeUndefined();
  });

  it('매매일지 10개 → 업적 + 이번 달 챌린지', async () => {
    const { ach, trading, buy, ids, unlocked } = setup();
    for (let i = 0; i < 10; i++) {
      const { order } = await buy();
      trading.saveNote(order.id, { text: `이유 ${i}`, tags: [] });
    }
    // 빈 메모는 안 셈
    const { order } = await buy();
    trading.saveNote(order.id, { text: '', tags: [] });
    await ach.check();
    expect(ids()).toContain('journal10');
    expect(ids()).toContain('challenge:journal10:2026-11');
    expect(unlocked.find((u) => u.kind === 'challenge')).toMatchObject({ title: '이번 달 매매일지 10개' });
    const v = await ach.view();
    expect(v.challenges.find((c) => c.id === 'journal10')).toMatchObject({ status: 'done', progress: 1, value: 10 });
  });

  it('시즌 수익률 +10% + 이번 달 +5% (지금 자산 기준), 리셋해도 업적은 유지', async () => {
    const { ach, trading, provider, buy, ids } = setup();
    await buy(100); // 약 700만원
    provider.prices.set('005930', 85_000); // +150만원쯤
    await ach.check();
    expect(ids()).toEqual(expect.arrayContaining(['firstBuy', 'seasonReturn10', 'challenge:profit5:2026-11']));

    // 값이 다시 내려가도 이번 달 +5%는 달성으로 남음
    provider.prices.set('005930', 70_000);
    let v = await ach.view();
    expect(v.challenges.find((c) => c.id === 'profit5')).toMatchObject({ status: 'done', progress: 1 });

    await trading.reset();
    await ach.check();
    expect(ids()).toContain('firstSeasonEnd');
    v = await ach.view();
    const unlockedIds = v.achievements.filter((a) => a.unlockedAt !== undefined).map((a) => a.id);
    expect(unlockedIds).toEqual(['firstBuy', 'seasonReturn10', 'firstSeasonEnd']);
  });

  it('가격 알림·관심 그룹 (기본 그룹은 안 셈)', async () => {
    const { db, ach, provider, ids } = setup();
    const watch = new WatchlistService(db, () => KR_OPEN);
    watch.list(); // 기본 그룹 생성
    await ach.check();
    expect(ids()).toEqual([]);
    watch.create('반도체');
    const [quote] = await provider.getQuotes(['005930']);
    new AlertService(db, () => KR_OPEN).create({ code: '005930', kind: 'above', value: 80_000 }, quote!);
    await ach.check();
    expect(ids()).toEqual(['firstAlert', 'watchGroup']);
  });

  it('처음 시작할 땐 지난 기록으로 조용히 채움 (알림 없음)', async () => {
    const { ach, buy, unlocked, trading } = setup();
    await buy();
    const stop = ach.start();
    await ach.check();
    expect(unlocked).toEqual([]);
    expect((await ach.view()).achievements.find((a) => a.id === 'firstBuy')?.unlockedAt).toBe(KR_OPEN);
    // 이미 달성한 건 다시 알리지 않음
    await trading.exchange('KRW', 100_000);
    await ach.check();
    expect(unlocked.map((u) => u.id)).toEqual(['firstFx']);
    stop();
  });

  it('grant: 리플레이 등 밖에서 달성 처리 (없는 id는 무시, 두 번째는 false)', () => {
    const { ach, ids } = setup();
    expect(ach.grant('nope')).toBe(false);
    expect(ach.grant('firstBuy')).toBe(true);
    expect(ach.grant('firstBuy')).toBe(false);
    expect(ids()).toEqual(['firstBuy']);
  });
});

describe('챌린지', () => {
  it('MDD: 이번 달 기록만 보고 -10% 넘게 빠지면 실패', async () => {
    const { ach, trading } = setup();
    const acc = trading.account();
    const snap = (day: string, totalKrw: number) =>
      trading.repo.insertSnapshot(acc.id, { day, totalKrw, stockKrw: 0, cash: acc.cash, usdKrw: 1_400, createdAt: KR_OPEN });
    snap('2026-10-20', 20_000_000); // 지난달: 무시
    snap('2026-11-01', 11_000_000);
    snap('2026-11-02', 10_500_000);
    // 오늘 기록(2026-11-03) = 시작 때 1,000만원 → 1,100만 대비 -9.1%
    let c = (await ach.view()).challenges.find((x) => x.id === 'mdd10')!;
    expect(c.status).toBe('active');
    expect(c.value).toBeCloseTo(10 / 11 - 1, 6);
    // 이번 달 2일 지남 / 30일
    expect(c.progress).toBeCloseTo((KR_OPEN - monthRange(KR_OPEN).start) / (30 * 86_400_000), 6);

    snap('2026-11-04', 9_800_000);
    snap('2026-11-05', 9_000_000); // -18%
    c = (await ach.view()).challenges.find((x) => x.id === 'mdd10')!;
    expect(c).toMatchObject({ status: 'failed', progress: 0 });
  });

  it('이번 달 +5%: 이번 달 첫 기록 대비', async () => {
    const { ach, trading } = setup();
    const acc = trading.account();
    // 시작 기록(11-03, 1,000만원)보다 앞선 이번 달 기록
    trading.repo.insertSnapshot(acc.id, { day: '2026-11-01', totalKrw: 9_600_000, stockKrw: 0, cash: acc.cash, usdKrw: 1_400, createdAt: KR_OPEN });
    const c = (await ach.view()).challenges.find((x) => x.id === 'profit5')!;
    expect(c.value).toBeCloseTo(10_000_000 / 9_600_000 - 1, 6);
    expect(c.progress).toBeCloseTo(c.value / 0.05, 6);
    expect(c.status).toBe('active');
  });
});

describe('업적 API', () => {
  it('GET /api/achievements + 설정 변경 뒤 확인 → 실시간 알림', async () => {
    const db = openDb(':memory:');
    const provider = new TestProvider();
    const trading = new TradingService({ db, provider, now: () => KR_OPEN });
    const achievements = new AchievementService({ trading, now: () => KR_OPEN });
    const app = await buildApp({ provider, trading, watchlists: new WatchlistService(db, () => KR_OPEN), achievements });
    const got = new Promise<AchievementUnlock>((resolve) => achievements.onUnlock(resolve));

    const res = await app.inject('/api/achievements');
    expect(res.statusCode).toBe(200);
    expect(res.json().achievements).toHaveLength(12);

    expect((await app.inject({ method: 'POST', url: '/api/watchlists', payload: { name: '2차전지' } })).statusCode).toBe(201);
    expect(await got).toMatchObject({ kind: 'achievement', id: 'watchGroup', title: '관심 그룹 만들기' });

    const msg: ServerMessage = { type: 'achievement', ...(await got) };
    expect(msg.type).toBe('achievement');
    await app.close();
  });
});
