// 실제 네이버·야후 응답(2026-11-03 저장본)으로 파싱 확인
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isKrRegularMinute, parseNaverCandles, parseNaverQuote, parseNaverStock } from '../src/market/naver';
import { parseYahooChart, parseYahooMeta, yahooSymbol } from '../src/market/yahoo';

const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

describe('네이버', () => {
  it('국내 실시간 시세', () => {
    const [samsung] = fx('naver-poll-kr.json').datas;
    expect(parseNaverQuote(samsung, '005930')).toMatchObject({
      code: '005930', price: 221_500, prevClose: 229_000, change: -7_500, open: 220_500, delayMinutes: 0,
    });
  });

  it('미국 실시간 시세', () => {
    const [apple] = fx('naver-poll-us.json').datas;
    const q = parseNaverQuote(apple, 'AAPL')!;
    expect(q).toMatchObject({ price: 338.32, open: 342.67, volume: 64_757_691 });
    expect(q.prevClose).toBeCloseTo(344.63);
  });

  it('상승 종목은 등락이 양수', () => {
    const [up] = fx('naver-up-kosdaq.json').stocks;
    const q = parseNaverQuote(up, up.itemCode)!;
    expect(q.change).toBeGreaterThan(0);
    expect(q.changeRate).toBeGreaterThan(0);
  });

  it('가격 없으면 null', () => {
    expect(parseNaverQuote({ closePrice: '' }, 'X')).toBeNull();
  });

  it('종목 목록: 국내', () => {
    const [first] = fx('naver-list-kospi.json').stocks;
    expect(parseNaverStock(first, 'KR', 'KOSPI')).toEqual({
      code: '005930', market: 'KR', exchange: 'KOSPI', nameKo: '삼성전자', nameEn: '', currency: 'KRW',
    });
  });

  it('종목 목록: 미국 (한글명, "BRK B" → BRK.B)', () => {
    const stocks = fx('naver-list-nyse.json').stocks.map((x: never) => parseNaverStock(x, 'US', 'NYSE'));
    expect(stocks).toContainEqual(expect.objectContaining({ code: 'BRK.B', naverCode: 'BRKb', nameKo: '버크셔 해서웨이 Class B' }));
    expect(stocks).toContainEqual(expect.objectContaining({ code: 'JPM', naverCode: 'JPM', currency: 'USD' }));
  });

  it('일봉: 날짜 → UTC 0시', () => {
    const [c] = parseNaverCandles(fx('naver-chart-day.json'));
    expect(c).toEqual({ time: Date.UTC(2026, 9, 20) / 1000, open: 219_500, high: 219_500, low: 208_000, close: 209_000, volume: 16_561_224 });
  });

  it('정규장 시간 판별 (한국시간 09:00~15:30)', () => {
    const t = (iso: string) => Date.parse(iso) / 1000;
    expect(isKrRegularMinute(t('2026-11-03T08:59:00+09:00'))).toBe(false);
    expect(isKrRegularMinute(t('2026-11-03T09:00:00+09:00'))).toBe(true);
    expect(isKrRegularMinute(t('2026-11-03T15:29:00+09:00'))).toBe(true);
    expect(isKrRegularMinute(t('2026-11-03T15:30:00+09:00'))).toBe(false);
  });

  it('분봉: 한국시간 → epoch', () => {
    const [c] = parseNaverCandles(fx('naver-chart-minute.json'));
    expect(c!.time).toBe(Date.parse('2026-11-03T09:00:00+09:00') / 1000);
    expect(c!.close).toBe(219_250);
  });
});

describe('야후', () => {
  it('심볼 변환', () => {
    expect(yahooSymbol({ code: '005930', market: 'KR', exchange: 'KOSPI' })).toBe('005930.KS');
    expect(yahooSymbol({ code: '196170', market: 'KR', exchange: 'KOSDAQ' })).toBe('196170.KQ');
    expect(yahooSymbol({ code: 'BRK.B', market: 'US', exchange: 'NYSE' })).toBe('BRK-B');
  });

  it('spark 시세 (한국은 20분 지연 표시)', () => {
    const results = fx('yahoo-spark.json').spark.result;
    const ks = results.find((r: { symbol: string }) => r.symbol === '005930.KS').response[0].meta;
    expect(parseYahooMeta(ks, '005930', 20)).toMatchObject({ price: 221_000, prevClose: 229_000, change: -8_000, delayMinutes: 20 });
  });

  it('분봉 차트', () => {
    const candles = parseYahooChart(fx('yahoo-chart-5m.json'), false);
    expect(candles.length).toBeGreaterThan(0);
    expect(candles.every((c) => c.time % 300 === 0)).toBe(true);
  });

  it('일봉 차트: 현지 날짜 기준, 소수 4자리', () => {
    const candles = parseYahooChart(fx('yahoo-chart-1d.json'), true);
    expect(candles.every((c) => c.time % 86_400 === 0)).toBe(true);
    expect(candles.every((c) => Number(c.close.toFixed(4)) === c.close)).toBe(true);
  });

  it('오류 응답', () => {
    expect(() => parseYahooChart({ chart: { result: [], error: { description: 'No data' } } } as never, true)).toThrow('No data');
  });
});
