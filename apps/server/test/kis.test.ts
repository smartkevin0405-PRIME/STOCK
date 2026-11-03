// 한투(KIS) 시세 소스. 키가 없어 실제 호출은 못 하고, 공식 예제의 필드 이름으로 만든 예시 응답(fixtures/kis-*.json)으로 확인
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import {
  KIS_ALLOWLIST,
  KisBlockedError,
  KisClient,
  KisSource,
  assertKisAllowed,
  kisFromEnv,
  kstYmd,
  parseKisDomesticCandles,
  parseKisDomesticQuote,
  parseKisOrderBook,
  parseKisOverseasCandles,
  parseKisOverseasQuote,
  parseKstDateTime,
} from '../src/market/kis';
import { UnsupportedError } from '../src/market/sources';
import { APPLE, SAMSUNG, TestProvider } from './helpers';

const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const NOW = Date.parse('2026-11-03T01:00:00Z'); // 화 10:00 KST

const TOKEN = {
  access_token: 'test-token-1',
  access_token_token_expired: '2026-11-04 10:00:00',
  token_type: 'Bearer',
  expires_in: 86_400,
};

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** 가짜 한투 서버: 경로별 응답 */
function fakeKis(routes: Record<string, unknown | ((call: Call) => { status?: number; body: unknown })>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = { url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, ...(typeof init?.body === 'string' ? { body: init.body } : {}) };
    calls.push(call);
    const route = routes[url.pathname];
    if (route === undefined) return new Response('{}', { status: 404 });
    const { status = 200, body } = typeof route === 'function' ? (route as (c: Call) => { status?: number; body: unknown })(call) : { body: route };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

function makeClient(fetchFn: typeof fetch, extra: Partial<ConstructorParameters<typeof KisClient>[0]> = {}) {
  let now = NOW;
  const waits: number[] = [];
  const client = new KisClient({
    appKey: 'app-key',
    appSecret: 'app-secret',
    fetch: fetchFn,
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    ...extra,
  });
  return { client, waits, advance: (ms: number) => (now += ms), now: () => now };
}

const ROUTES = {
  '/oauth2/tokenP': TOKEN,
  '/uapi/domestic-stock/v1/quotations/inquire-price': fx('kis-domestic-price.json'),
  '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn': fx('kis-domestic-orderbook.json'),
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice': fx('kis-domestic-daily.json'),
  '/uapi/overseas-price/v1/quotations/price': fx('kis-overseas-price.json'),
  '/uapi/overseas-price/v1/quotations/dailyprice': fx('kis-overseas-daily.json'),
};

describe('한투 허용 목록 (시세만, 주문 불가)', () => {
  it('허용된 시세 조회만 통과', () => {
    for (const [path, rule] of Object.entries(KIS_ALLOWLIST)) {
      expect(() => assertKisAllowed(path, rule.method, rule.trId)).not.toThrow();
    }
    expect(Object.keys(KIS_ALLOWLIST).filter((p) => p !== '/oauth2/tokenP').every((p) => p.includes('/quotations/'))).toBe(true);
  });

  it('주문·잔고·다른 TR·다른 메서드는 막음', () => {
    expect(() => assertKisAllowed('/uapi/domestic-stock/v1/trading/order-cash', 'POST', 'TTTC0802U')).toThrow(KisBlockedError);
    expect(() => assertKisAllowed('/uapi/domestic-stock/v1/trading/inquire-balance', 'GET', 'TTTC8434R')).toThrow(KisBlockedError);
    expect(() => assertKisAllowed('/uapi/overseas-stock/v1/trading/order', 'POST', 'TTTT1002U')).toThrow(KisBlockedError);
    expect(() => assertKisAllowed('/uapi/domestic-stock/v1/quotations/inquire-price', 'GET', 'TTTC0802U')).toThrow(KisBlockedError);
    expect(() => assertKisAllowed('/uapi/domestic-stock/v1/quotations/inquire-price', 'POST', 'FHKST01010100')).toThrow(KisBlockedError);
    expect(() => assertKisAllowed('/oauth2/tokenP', 'GET')).toThrow(KisBlockedError);
    expect(() => assertKisAllowed('constructor', 'GET')).toThrow(KisBlockedError);
  });

  it('허용 목록 밖 호출은 네트워크에 안 나감', async () => {
    const { calls, fetchFn } = fakeKis(ROUTES);
    const { client } = makeClient(fetchFn);
    await expect(client.get('/uapi/domestic-stock/v1/trading/order-cash', 'TTTC0802U', {})).rejects.toThrow(KisBlockedError);
    expect(calls).toHaveLength(0);
  });

  it('허용 목록은 바꿀 수 없음', () => {
    expect(Object.isFrozen(KIS_ALLOWLIST)).toBe(true);
  });
});

describe('한투 응답 파싱 (예시 응답)', () => {
  it('국내 현재가', () => {
    const q = parseKisDomesticQuote(fx('kis-domestic-price.json').output, '005930', NOW)!;
    expect(q).toMatchObject({ code: '005930', price: 70_500, prevClose: 71_000, change: -500, open: 71_000, high: 71_200, low: 70_300, volume: 12_345_678, delayMinutes: 0 });
    expect(q.changeRate).toBeCloseTo(-500 / 71_000);
  });

  it('부호 없이 온 하락도 음수로', () => {
    const q = parseKisDomesticQuote({ stck_prpr: '70500', prdy_vrss: '500', prdy_vrss_sign: '5' }, '005930', NOW)!;
    expect(q.change).toBe(-500);
    expect(parseKisDomesticQuote({ stck_prpr: '0' }, '005930', NOW)).toBeNull();
  });

  it('국내 10단계 호가', () => {
    const book = parseKisOrderBook(fx('kis-domestic-orderbook.json'), '005930', NOW)!;
    expect(book.asks).toHaveLength(10);
    expect(book.bids).toHaveLength(10);
    expect(book.asks[0]).toEqual({ price: 70_600, qty: 15_234 });
    expect(book.bids[0]).toEqual({ price: 70_500, qty: 40_211 });
    expect(book.asks[9]!.price).toBe(71_500);
    expect(book).toMatchObject({ totalAskQty: 179_365, totalBidQty: 241_211, source: 'kis' });
    expect(parseKisOrderBook({ rt_cd: '0', output1: {} }, '005930', NOW)).toBeNull();
  });

  it('국내 일봉: 오래된 것부터, 날짜는 UTC 0시', () => {
    const c = parseKisDomesticCandles(fx('kis-domestic-daily.json').output2);
    expect(c.map((x) => x.close)).toEqual([70_100, 71_000, 70_500]);
    expect(c[2]).toEqual({ time: Date.UTC(2026, 10, 3) / 1000, open: 71_000, high: 71_200, low: 70_300, close: 70_500, volume: 12_345_678 });
  });

  it('미국 현재가·일봉', () => {
    const q = parseKisOverseasQuote(fx('kis-overseas-price.json').output, 'AAPL', NOW)!;
    expect(q).toMatchObject({ code: 'AAPL', price: 203.5, prevClose: 200, change: 3.5, volume: 45_000_000 });
    expect(q.changeRate).toBeCloseTo(0.0175);
    expect(parseKisOverseasQuote({ last: '', base: '200' }, 'AAPL', NOW)).toBeNull();
    const c = parseKisOverseasCandles(fx('kis-overseas-daily.json').output2);
    expect(c.map((x) => x.close)).toEqual([200, 203.5]);
    expect(c[1]!.time).toBe(Date.UTC(2026, 10, 2) / 1000);
  });

  it('토큰 만료 시각은 한국시간', () => {
    expect(parseKstDateTime('2026-11-04 10:00:00')).toBe(Date.parse('2026-11-04T01:00:00Z'));
    expect(parseKstDateTime('nope')).toBeUndefined();
    expect(kstYmd(Date.parse('2026-11-02T16:00:00Z'))).toBe('20261103');
  });
});

describe('한투 클라이언트', () => {
  it('토큰 한 번 발급 → 파일에 저장 → 재시작해도 다시 씀', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kis-'));
    const tokenFile = join(dir, 'kis-token.json');
    const a = fakeKis(ROUTES);
    const { client } = makeClient(a.fetchFn, { tokenFile });
    await client.get('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930' });
    await client.get('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '000660' });
    expect(a.calls.filter((c) => c.url.pathname === '/oauth2/tokenP')).toHaveLength(1);

    const tokenCall = a.calls[0]!;
    expect(tokenCall.method).toBe('POST');
    expect(JSON.parse(tokenCall.body!)).toEqual({ grant_type: 'client_credentials', appkey: 'app-key', appsecret: 'app-secret' });

    const q = a.calls[1]!;
    expect(q.url.origin).toBe('https://openapi.koreainvestment.com:9443');
    expect(q.url.searchParams.get('FID_INPUT_ISCD')).toBe('005930');
    expect(q.headers).toMatchObject({ authorization: 'Bearer test-token-1', appkey: 'app-key', appsecret: 'app-secret', tr_id: 'FHKST01010100', custtype: 'P' });

    // 파일엔 앱키 원문이 없음, 권한 600
    const saved = readFileSync(tokenFile, 'utf8');
    expect(saved).not.toContain('app-key');
    expect(statSync(tokenFile).mode & 0o777).toBe(0o600);

    const b = fakeKis(ROUTES);
    const { client: again } = makeClient(b.fetchFn, { tokenFile });
    await again.get('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930' });
    expect(b.calls.map((c) => c.url.pathname)).toEqual(['/uapi/domestic-stock/v1/quotations/inquire-price']);

    // 앱키가 바뀌면 저장된 토큰 안 씀
    const c = fakeKis(ROUTES);
    const { client: other } = makeClient(c.fetchFn, { tokenFile, appKey: 'other-key' });
    await other.accessToken();
    expect(c.calls.map((x) => x.url.pathname)).toEqual(['/oauth2/tokenP']);
  });

  it('모의투자 도메인 + 느린 간격', async () => {
    const a = fakeKis(ROUTES);
    const { client, waits } = makeClient(a.fetchFn, { env: 'paper' });
    for (let i = 0; i < 3; i++) await client.get('/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', { AUTH: '', EXCD: 'NAS', SYMB: 'AAPL' });
    expect(a.calls[1]!.url.origin).toBe('https://openapivts.koreainvestment.com:29443');
    expect(waits).toEqual([520, 520]);
  });

  it('동시에 불러도 토큰은 한 번만, 호출은 간격 두고', async () => {
    const a = fakeKis(ROUTES);
    const { client, waits } = makeClient(a.fetchFn);
    await Promise.all([1, 2, 3].map(() => client.get('/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', { AUTH: '', EXCD: 'NAS', SYMB: 'AAPL' })));
    expect(a.calls.filter((c) => c.url.pathname === '/oauth2/tokenP')).toHaveLength(1);
    expect(waits).toEqual([60, 60]);
  });

  it('토큰 발급 실패 → 1분 안엔 다시 안 부름', async () => {
    const a = fakeKis({ '/oauth2/tokenP': () => ({ status: 403, body: { error_code: 'EGW00133', error_description: '접근토큰 발급 잠시 후 다시 시도하세요(1분당 1회)' } }) });
    const { client, advance } = makeClient(a.fetchFn);
    await expect(client.accessToken()).rejects.toThrow('토큰 발급 실패');
    await expect(client.accessToken()).rejects.toThrow('1분에 한 번');
    expect(a.calls).toHaveLength(1);
    advance(61_000);
    await expect(client.accessToken()).rejects.toThrow('토큰 발급 실패');
    expect(a.calls).toHaveLength(2);
  });

  it('토큰 만료 응답 → 새 토큰으로 한 번 재시도', async () => {
    let issued = 0;
    let served = 0;
    const a = fakeKis({
      '/oauth2/tokenP': () => ({ body: { ...TOKEN, access_token: `tok-${++issued}` } }),
      '/uapi/domestic-stock/v1/quotations/inquire-price': () =>
        ++served === 2 ? { status: 500, body: { rt_cd: '1', msg_cd: 'EGW00123', msg1: '기간이 만료된 token 입니다.' } } : { body: fx('kis-domestic-price.json') },
    });
    const { client, advance } = makeClient(a.fetchFn);
    const params = { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930' };
    await client.get('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', params);
    advance(120_000);
    const res = await client.get<{ rt_cd?: string }>('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', params);
    expect(res.rt_cd).toBe('0');
    expect(issued).toBe(2);
    expect(a.calls.at(-1)!.headers.authorization).toBe('Bearer tok-2');
  });

  it('rt_cd가 0이 아니면 오류', async () => {
    const a = fakeKis({ ...ROUTES, '/uapi/overseas-price/v1/quotations/price': { rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' } });
    const { client } = makeClient(a.fetchFn);
    await expect(client.get('/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', {})).rejects.toThrow('EGW00201');
  });
});

describe('한투 시세 소스', () => {
  it('국내 시세 + 최근 호가의 매도·매수 1호가', async () => {
    const a = fakeKis(ROUTES);
    const { client, now } = makeClient(a.fetchFn);
    const kr = new KisSource(client, 'KR', { now });
    const [plain] = await kr.fetchQuotes([SAMSUNG]);
    expect(plain).toMatchObject({ code: '005930', price: 70_500 });
    expect(plain!.ask).toBeUndefined();

    const book = await kr.fetchOrderBook(SAMSUNG);
    expect(book!.asks).toHaveLength(10);
    const [withBook] = await kr.fetchQuotes([SAMSUNG]);
    expect(withBook).toMatchObject({ ask: 70_600, bid: 70_500 });

    // 다른 시장 종목은 건너뜀, 미국 호가는 안 줌
    expect(await kr.fetchQuotes([APPLE])).toEqual([]);
    expect(await new KisSource(client, 'US').fetchOrderBook(APPLE)).toBeNull();
  });

  it('미국 시세·일봉', async () => {
    const a = fakeKis(ROUTES);
    const { client } = makeClient(a.fetchFn);
    const us = new KisSource(client, 'US');
    const [q] = await us.fetchQuotes([APPLE]);
    expect(q).toMatchObject({ code: 'AAPL', price: 203.5 });
    const priceCall = a.calls.find((c) => c.url.pathname.endsWith('/price'))!;
    expect(priceCall.url.searchParams.get('EXCD')).toBe('NAS');
    expect(priceCall.headers.tr_id).toBe('HHDFS00000300');

    const candles = await us.fetchCandles(APPLE, '1d', 2);
    expect(candles.map((c) => c.close)).toEqual([200, 203.5]);
    const daily = a.calls.find((c) => c.url.pathname.endsWith('/dailyprice'))!;
    expect(Object.fromEntries(daily.url.searchParams)).toMatchObject({ EXCD: 'NAS', SYMB: 'AAPL', GUBN: '0', BYMD: '', MODP: '1' });

    // 점 들어간 티커는 다음 소스에 맡김
    expect(await us.fetchQuotes([{ ...APPLE, code: 'BRK.B', exchange: 'NYSE' }])).toEqual([]);
  });

  it('국내 일봉: 날짜 범위 + 100건씩 이어 받기', async () => {
    const a = fakeKis(ROUTES);
    const { client, now } = makeClient(a.fetchFn);
    const kr = new KisSource(client, 'KR', { now });
    const candles = await kr.fetchCandles(SAMSUNG, '1w', 5);
    expect(candles).toHaveLength(3);
    const daily = a.calls.filter((c) => c.url.pathname.endsWith('/inquire-daily-itemchartprice'));
    expect(daily[0]!.url.searchParams.get('FID_PERIOD_DIV_CODE')).toBe('W');
    expect(daily[0]!.url.searchParams.get('FID_INPUT_DATE_2')).toBe('20261103');
    // 두 번째 요청은 가장 오래된 날 전날까지
    expect(daily[1]!.url.searchParams.get('FID_INPUT_DATE_2')).toBe('20261029');
  });

  it('분봉은 다음 소스로', async () => {
    const { client } = makeClient(fakeKis(ROUTES).fetchFn);
    await expect(new KisSource(client, 'KR').fetchCandles(SAMSUNG, '5m', 10)).rejects.toBeInstanceOf(UnsupportedError);
  });

  it('키 없으면 꺼짐', () => {
    expect(kisFromEnv({}, '/tmp')).toBeNull();
    expect(kisFromEnv({ KIS_APP_KEY: 'a' }, '/tmp')).toBeNull();
    const on = kisFromEnv({ KIS_APP_KEY: 'a', KIS_APP_SECRET: 'b', KIS_ENV: 'paper' }, '/tmp')!;
    expect(on.env).toBe('paper');
    expect(on.KR.name).toBe('kis');
  });
});

describe('호가 API', () => {
  const provider = new TestProvider();
  let withBook: Awaited<ReturnType<typeof buildApp>>;
  let without: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    const { client } = makeClient(fakeKis(ROUTES).fetchFn);
    const kr = new KisSource(client, 'KR');
    withBook = await buildApp({ provider, orderBook: (s) => kr.fetchOrderBook(s) });
    without = await buildApp({ provider });
  });
  afterAll(async () => {
    await withBook.close();
    await without.close();
  });

  it('호가 주는 소스가 있으면 10단계', async () => {
    const res = await withBook.inject('/api/orderbook/005930');
    expect(res.statusCode).toBe(200);
    expect(res.json().book.asks).toHaveLength(10);
  });

  it('미국 종목·없는 종목·소스 없음 → 404', async () => {
    expect((await withBook.inject('/api/orderbook/AAPL')).statusCode).toBe(404);
    expect((await withBook.inject('/api/orderbook/NOPE')).statusCode).toBe(404);
    expect((await without.inject('/api/orderbook/005930')).statusCode).toBe(404);
  });
});
