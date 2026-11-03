import type { Quote } from '@stock/shared';
import { describe, expect, it } from 'vitest';
import { AlertService, alertMet, describeAlert } from '../src/trading/alerts';
import { openDb } from '../src/trading/db';
import { PushService, type PushSubscriptionJson } from '../src/trading/push';

const q = (price: number, prevClose = 70_000, code = '005930'): Quote => ({
  code, price, prevClose, volume: 0, change: price - prevClose, changeRate: (price - prevClose) / prevClose, timestamp: 0,
});

describe('알림 조건', () => {
  it('가격 이상·이하, 전일 대비 상승·하락 %', () => {
    expect(alertMet('above', 75_000, q(75_000))).toBe(true);
    expect(alertMet('above', 75_000, q(74_900))).toBe(false);
    expect(alertMet('below', 65_000, q(65_000))).toBe(true);
    expect(alertMet('rise', 5, q(73_500))).toBe(true); // +5%
    expect(alertMet('rise', 5, q(73_400))).toBe(false);
    expect(alertMet('fall', 3, q(67_900))).toBe(true); // -3%
  });

  it('문장', () => {
    expect(describeAlert({ kind: 'above', value: 75_000 })).toBe('75,000원 이상');
    expect(describeAlert({ kind: 'below', value: 12.5 }, { currency: 'USD' })).toBe('$12.5 이하');
    expect(describeAlert({ kind: 'fall', value: 3 })).toBe('전일 대비 -3% 이하');
  });
});

describe('가격 알림', () => {
  const make = () => {
    let now = 1_000;
    const svc = new AlertService(openDb(':memory:'), () => now);
    return { svc, tick: () => (now += 1_000) };
  };

  it('등록 → 조건 만족 시 한 번만 울리고 꺼짐', () => {
    const { svc } = make();
    const fired: number[] = [];
    svc.onTrigger((a) => fired.push(a.id));
    const a = svc.create({ code: '005930', kind: 'above', value: 72_000 }, q(70_000));
    expect(svc.activeCodes()).toEqual(['005930']);

    expect(svc.check(q(71_900))).toEqual([]);
    expect(svc.check(q(72_100))[0]).toMatchObject({ id: a.id, active: false, triggeredPrice: 72_100 });
    expect(svc.check(q(73_000))).toEqual([]);
    expect(fired).toEqual([a.id]);
    expect(svc.activeCodes()).toEqual([]);
  });

  it('다른 종목 시세는 무시', () => {
    const { svc } = make();
    svc.create({ code: '005930', kind: 'below', value: 60_000 }, q(70_000));
    expect(svc.check(q(50_000, 70_000, '000660'))).toEqual([]);
  });

  it('이미 만족한 조건·잘못된 값은 등록 거부', () => {
    const { svc } = make();
    expect(() => svc.create({ code: '005930', kind: 'above', value: 69_000 }, q(70_000))).toThrow('이미 69,000원 이상');
    expect(() => svc.create({ code: '005930', kind: 'rise', value: 0 }, q(70_000))).toThrow('%');
    expect(() => svc.create({ code: '005930', kind: 'fall', value: 150 }, q(70_000))).toThrow('100%');
  });

  it('삭제', () => {
    const { svc } = make();
    const a = svc.create({ code: '005930', kind: 'above', value: 80_000 }, q(70_000));
    svc.remove(a.id);
    expect(svc.list()).toEqual([]);
    expect(() => svc.remove(a.id)).toThrow('찾을 수 없어요');
  });
});

describe('폰 푸시', () => {
  const sub = (n: number): PushSubscriptionJson => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'k', auth: 'a' } });

  it('모든 기기로 발송, 사라진 구독(410)은 정리', async () => {
    const sent: string[] = [];
    const push = new PushService(openDb(':memory:'), 'pub', async (s, payload) => {
      if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      sent.push(`${s.endpoint}|${JSON.parse(payload).title}`);
    });
    push.subscribe(sub(1));
    push.subscribe(sub(2));
    push.subscribe(sub(1)); // 같은 기기 다시 등록 → 하나로
    expect(push.count()).toBe(2);

    expect(await push.notify({ title: '테스트', body: '본문' })).toBe(1);
    expect(sent).toEqual(['https://push.example/1|테스트']);
    expect(push.count()).toBe(1);
  });

  it('일시적인 오류는 구독 유지', async () => {
    const push = new PushService(openDb(':memory:'), 'pub', async () => {
      throw Object.assign(new Error('busy'), { statusCode: 503 });
    });
    push.subscribe(sub(1));
    expect(await push.notify({ title: 't', body: 'b' })).toBe(0);
    expect(push.count()).toBe(1);
  });
});
