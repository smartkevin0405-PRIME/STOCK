import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Candle, CandleInterval, Exchange, Market, OrderBook, OrderBookLevel, Quote, StockInfo } from '@stock/shared';
import { num } from './http';
import { UnsupportedError, type QuoteSource } from './sources';

// 한국투자증권 Open API (KIS Developers) — 시세 조회 전용. 키가 있을 때만 켜짐.
// 주문·잔고 API는 아래 허용 목록에 없어서 부를 수 없음 (실제 주문 절대 불가).
//
// 참고한 공식 자료 (github.com/koreainvestment/open-trading-api, main 브랜치, 2026-11 확인):
// - kis_devlp.yaml: 도메인 (실전 openapi.koreainvestment.com:9443 / 모의 openapivts.koreainvestment.com:29443)
// - examples_llm/kis_auth.py: 토큰 발급 POST /oauth2/tokenP {grant_type, appkey, appsecret},
//   응답 access_token·access_token_token_expired("YYYY-MM-DD HH:MM:SS"), 유효 1일·6시간 안 재발급 시 같은 토큰,
//   공통 헤더 (authorization Bearer, appkey, appsecret, tr_id, custtype=P), 응답 rt_cd "0" = 성공 / msg_cd·msg1,
//   호출 간격 실전 0.05초 · 모의 0.5초 (smart_sleep)
// - examples_llm/domestic_stock/inquire_price (FHKST01010100), inquire_asking_price_exp_ccn (FHKST01010200),
//   inquire_daily_itemchartprice (FHKST03010100, 한 번에 최대 100건) 와 각 chk_*.py의 응답 필드 이름
// - examples_llm/overseas_stock/price (HHDFS00000300), dailyprice (HHDFS76240000) 와 chk_*.py의 응답 필드 이름
// - legacy/postman 실전계좌 샘플 (요청 헤더 확인)
// 키가 없어 실제 호출로는 아직 확인하지 못함.

export type KisEnv = 'real' | 'paper';

export const KIS_DOMAINS: Record<KisEnv, string> = {
  real: 'https://openapi.koreainvestment.com:9443',
  paper: 'https://openapivts.koreainvestment.com:29443',
};

const PATH = {
  token: '/oauth2/tokenP',
  krPrice: '/uapi/domestic-stock/v1/quotations/inquire-price',
  krBook: '/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn',
  krDaily: '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',
  usPrice: '/uapi/overseas-price/v1/quotations/price',
  usDaily: '/uapi/overseas-price/v1/quotations/dailyprice',
} as const;

const TR = {
  krPrice: 'FHKST01010100',
  krBook: 'FHKST01010200',
  krDaily: 'FHKST03010100',
  usPrice: 'HHDFS00000300',
  usDaily: 'HHDFS76240000',
} as const;

/** 호출 허용 목록: 토큰 발급 + 시세 조회만. 여기 없는 경로·TR은 무조건 막음 */
export const KIS_ALLOWLIST: Readonly<Record<string, { method: 'GET' | 'POST'; trId?: string }>> = Object.freeze({
  [PATH.token]: { method: 'POST' },
  [PATH.krPrice]: { method: 'GET', trId: TR.krPrice },
  [PATH.krBook]: { method: 'GET', trId: TR.krBook },
  [PATH.krDaily]: { method: 'GET', trId: TR.krDaily },
  [PATH.usPrice]: { method: 'GET', trId: TR.usPrice },
  [PATH.usDaily]: { method: 'GET', trId: TR.usDaily },
});

/** 허용 목록 밖 호출 */
export class KisBlockedError extends Error {}

export function assertKisAllowed(path: string, method: 'GET' | 'POST', trId?: string): void {
  const rule = Object.hasOwn(KIS_ALLOWLIST, path) ? KIS_ALLOWLIST[path] : undefined;
  if (!rule || rule.method !== method || rule.trId !== trId) {
    throw new KisBlockedError(`한투 API 허용 목록에 없는 호출이에요: ${method} ${path}${trId ? ` (${trId})` : ''}`);
  }
}

/** 공통 응답 틀 */
interface KisEnvelope {
  rt_cd?: string;
  msg_cd?: string;
  msg1?: string;
}

interface TokenResponse {
  access_token?: string;
  access_token_token_expired?: string;
  token_type?: string;
  expires_in?: number;
  error_description?: string;
  error_code?: string;
}

type Fields = Record<string, string | undefined>;

export interface KisDomesticPriceResponse extends KisEnvelope {
  output?: Fields;
}
export interface KisOrderBookResponse extends KisEnvelope {
  output1?: Fields;
  output2?: Fields;
}
export interface KisDomesticDailyResponse extends KisEnvelope {
  output1?: Fields;
  output2?: Fields[];
}
export interface KisOverseasPriceResponse extends KisEnvelope {
  output?: Fields;
}
export interface KisOverseasDailyResponse extends KisEnvelope {
  output1?: Fields;
  output2?: Fields[];
}

// 토큰이 만료·무효일 때 오는 코드 (한 번만 새로 받아서 재시도)
const TOKEN_ERRORS = new Set(['EGW00121', 'EGW00123']);

/** 한국시간 "2026-11-04 08:10:10" → epoch ms */
export function parseKstDateTime(s: string | undefined): number | undefined {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return undefined;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]! - 9, +m[5]!, +m[6]!);
}

/** epoch ms → 한국 날짜 "YYYYMMDD" */
export function kstYmd(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** "YYYYMMDD" → 그날 UTC 0시 (초). 네이버·야후 일봉과 같은 기준 */
function ymdToTime(d: string | undefined): number | undefined {
  if (!d || !/^\d{8}$/.test(d)) return undefined;
  return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 1000;
}

const positive = (v: unknown) => {
  const n = num(v);
  return n !== undefined && n > 0 ? n : undefined;
};

export interface KisClientOptions {
  appKey: string;
  appSecret: string;
  env?: KisEnv;
  /** 토큰 저장 파일 (발급 횟수 제한 때문에 재시작해도 다시 씀) */
  tokenFile?: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** 호출 사이 최소 간격 (기본: 실전 60ms, 모의 520ms) */
  minIntervalMs?: number;
  timeoutMs?: number;
}

interface SavedToken {
  env: KisEnv;
  /** 앱키 해시 (키가 바뀌면 새로 발급) */
  key: string;
  token: string;
  expiresAt: number;
}

/** 토큰 관리 + 호출 간격 조절 + 허용 목록 검사 */
export class KisClient {
  readonly env: KisEnv;
  readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly keyHash: string;
  private token: { value: string; expiresAt: number } | undefined;
  private pending: Promise<string> | undefined;
  private rejected: string | undefined;
  private lastIssueAt = -Infinity;
  private queue: Promise<void> = Promise.resolve();
  private lastCallAt = -Infinity;

  constructor(private readonly o: KisClientOptions) {
    this.env = o.env ?? 'real';
    this.baseUrl = KIS_DOMAINS[this.env];
    this.fetchFn = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minIntervalMs = o.minIntervalMs ?? (this.env === 'paper' ? 520 : 60);
    this.timeoutMs = o.timeoutMs ?? 8_000;
    this.keyHash = createHash('sha256').update(o.appKey).digest('hex').slice(0, 16);
  }

  /** 시세 조회 GET. 허용 목록 밖이면 바로 예외 */
  async get<T extends KisEnvelope>(path: string, trId: string, params: Record<string, string>): Promise<T> {
    assertKisAllowed(path, 'GET', trId);
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      await this.throttle();
      const url = new URL(this.baseUrl + path);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const res = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: `Bearer ${token}`,
          appkey: this.o.appKey,
          appsecret: this.o.appSecret,
          tr_id: trId,
          custtype: 'P',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = (await res.json().catch(() => undefined)) as T | undefined;
      const tokenProblem = res.status === 401 || (body?.msg_cd !== undefined && TOKEN_ERRORS.has(body.msg_cd));
      if (tokenProblem && attempt === 0) {
        this.dropToken(token);
        continue;
      }
      if (!res.ok || !body || body.rt_cd !== '0') {
        const why = [body?.msg_cd, body?.msg1].filter(Boolean).join(' ');
        throw new Error(`한투 시세 오류 (HTTP ${res.status}${why ? `, ${why}` : ''})`);
      }
      return body;
    }
  }

  /** 접근 토큰: 메모리 → 파일 → 새로 발급 (1분에 한 번까지만) */
  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 5 * 60_000 > this.now()) return this.token.value;
    this.pending ??= this.loadOrIssue().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async loadOrIssue(): Promise<string> {
    const saved = this.readSaved();
    if (saved) {
      this.token = saved;
      return saved.value;
    }
    if (this.now() - this.lastIssueAt < 61_000) throw new Error('한투 토큰 발급은 1분에 한 번만 돼요. 잠시 후 다시 시도할게요');
    this.lastIssueAt = this.now();
    assertKisAllowed(PATH.token, 'POST');
    const res = await this.fetchFn(this.baseUrl + PATH.token, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.o.appKey, appsecret: this.o.appSecret }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await res.json().catch(() => undefined)) as TokenResponse | undefined;
    if (!res.ok || !body?.access_token) {
      throw new Error(`한투 토큰 발급 실패 (HTTP ${res.status}${body?.error_description ? `, ${body.error_description}` : ''})`);
    }
    const expiresAt = parseKstDateTime(body.access_token_token_expired) ?? this.now() + (body.expires_in ?? 86_400) * 1000;
    this.token = { value: body.access_token, expiresAt };
    this.writeSaved({ env: this.env, key: this.keyHash, token: body.access_token, expiresAt });
    return body.access_token;
  }

  private dropToken(token: string): void {
    this.rejected = token;
    if (this.token?.value === token) this.token = undefined;
  }

  private readSaved(): { value: string; expiresAt: number } | undefined {
    if (!this.o.tokenFile) return undefined;
    try {
      const s = JSON.parse(readFileSync(this.o.tokenFile, 'utf8')) as Partial<SavedToken>;
      if (s.env !== this.env || s.key !== this.keyHash || typeof s.token !== 'string' || typeof s.expiresAt !== 'number') return undefined;
      if (s.token === this.rejected || s.expiresAt - 5 * 60_000 <= this.now()) return undefined;
      return { value: s.token, expiresAt: s.expiresAt };
    } catch {
      return undefined;
    }
  }

  private writeSaved(s: SavedToken): void {
    if (!this.o.tokenFile) return;
    try {
      mkdirSync(dirname(this.o.tokenFile), { recursive: true });
      writeFileSync(this.o.tokenFile, JSON.stringify(s), { mode: 0o600 });
    } catch {
      // 저장 실패해도 메모리 토큰으로 계속 동작
    }
  }

  /** 호출을 한 줄로 세워서 최소 간격 유지 (초당 호출 수 제한) */
  private throttle(): Promise<void> {
    const turn = this.queue.then(async () => {
      const wait = this.lastCallAt + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastCallAt = this.now();
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }
}

// ─── 응답 파싱 (순수 함수) ────────────────────────────────

/** 국내 현재가 (inquire-price output) → Quote */
export function parseKisDomesticQuote(o: Fields | undefined, code: string, now: number): Quote | null {
  const price = positive(o?.stck_prpr);
  if (!o || price === undefined) return null;
  let change = num(o.prdy_vrss) ?? 0;
  // 전일 대비 부호: 1 상한, 2 상승, 3 보합, 4 하한, 5 하락 — 부호 없이 올 때 대비
  if ((o.prdy_vrss_sign === '4' || o.prdy_vrss_sign === '5') && change > 0) change = -change;
  const prevClose = price - change > 0 ? price - change : (positive(o.stck_sdpr) ?? price);
  return {
    code,
    price,
    prevClose,
    open: positive(o.stck_oprc),
    high: positive(o.stck_hgpr),
    low: positive(o.stck_lwpr),
    volume: num(o.acml_vol) ?? 0,
    change: price - prevClose,
    changeRate: (price - prevClose) / prevClose,
    timestamp: now,
    delayMinutes: 0,
  };
}

/** 해외 현재체결가 (price output) → Quote. 체결 없으면 null */
export function parseKisOverseasQuote(o: Fields | undefined, code: string, now: number): Quote | null {
  const price = positive(o?.last);
  const prevClose = positive(o?.base);
  if (!o || price === undefined || prevClose === undefined) return null;
  const change = Math.round((price - prevClose) * 10_000) / 10_000;
  return {
    code,
    price,
    prevClose,
    volume: num(o.tvol) ?? 0,
    change,
    changeRate: change / prevClose,
    timestamp: now,
    delayMinutes: 0,
  };
}

/** 국내 호가 (inquire-asking-price-exp-ccn output1) → 10단계 호가 */
export function parseKisOrderBook(res: KisOrderBookResponse, code: string, now: number): OrderBook | null {
  const o = res.output1;
  if (!o) return null;
  const side = (p: 'askp' | 'bidp'): OrderBookLevel[] => {
    const out: OrderBookLevel[] = [];
    for (let i = 1; i <= 10; i++) {
      const price = positive(o[`${p}${i}`]);
      if (price !== undefined) out.push({ price, qty: num(o[`${p}_rsqn${i}`]) ?? 0 });
    }
    return out;
  };
  const asks = side('askp');
  const bids = side('bidp');
  if (asks.length === 0 && bids.length === 0) return null;
  return {
    code,
    asks,
    bids,
    totalAskQty: num(o.total_askp_rsqn) ?? asks.reduce((s, l) => s + l.qty, 0),
    totalBidQty: num(o.total_bidp_rsqn) ?? bids.reduce((s, l) => s + l.qty, 0),
    timestamp: now,
    source: 'kis',
  };
}

/** 국내 기간별 시세 output2 (최신 먼저) → 오래된 것부터 */
export function parseKisDomesticCandles(rows: Fields[] | undefined): Candle[] {
  const out: Candle[] = [];
  for (const r of rows ?? []) {
    const time = ymdToTime(r.stck_bsop_date);
    const close = positive(r.stck_clpr);
    if (time === undefined || close === undefined) continue;
    out.push({
      time,
      open: positive(r.stck_oprc) ?? close,
      high: positive(r.stck_hgpr) ?? close,
      low: positive(r.stck_lwpr) ?? close,
      close,
      volume: num(r.acml_vol) ?? 0,
    });
  }
  return dedupeSort(out);
}

/** 해외 기간별 시세 output2 (최신 먼저) → 오래된 것부터 */
export function parseKisOverseasCandles(rows: Fields[] | undefined): Candle[] {
  const out: Candle[] = [];
  for (const r of rows ?? []) {
    const time = ymdToTime(r.xymd);
    const close = positive(r.clos);
    if (time === undefined || close === undefined) continue;
    out.push({
      time,
      open: positive(r.open) ?? close,
      high: positive(r.high) ?? close,
      low: positive(r.low) ?? close,
      close,
      volume: num(r.tvol) ?? 0,
    });
  }
  return dedupeSort(out);
}

function dedupeSort(candles: Candle[]): Candle[] {
  const byTime = new Map(candles.map((c) => [c.time, c]));
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

// ─── 시세 소스 ────────────────────────────────────────────

const US_EXCD: Partial<Record<Exchange, string>> = { NASDAQ: 'NAS', NYSE: 'NYS', AMEX: 'AMS' };

const PERIOD: Partial<Record<CandleInterval, { kr: string; us: string; daysPerBar: number }>> = {
  '1d': { kr: 'D', us: '0', daysPerBar: 1.6 },
  '1w': { kr: 'W', us: '1', daysPerBar: 7.1 },
  '1M': { kr: 'M', us: '2', daysPerBar: 31 },
};

/** 한 번에 100건이라 차트는 최대 이만큼만 이어서 받음 */
const MAX_CHART_PAGES = 3;

export interface KisSourceOptions {
  now?: () => number;
  /** 호가 캐시 시간 — 이 안에 받은 호가는 다시 안 부르고, 시세에 매도·매수 1호가로 붙임 */
  bookTtlMs?: number;
}

/**
 * 한투 시세 소스 (시장 하나). 국내: 현재가·호가·일/주/월봉, 미국: 현재가·일/주/월봉.
 * 분봉은 안 줘서 다음 소스(네이버·야후)로 넘김.
 */
export class KisSource implements QuoteSource {
  readonly name = 'kis';
  readonly delayMinutes = 0;
  private readonly books = new Map<string, { book: OrderBook; at: number }>();
  private readonly now: () => number;
  private readonly bookTtlMs: number;

  constructor(
    private readonly client: KisClient,
    private readonly market: Market,
    options: KisSourceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.bookTtlMs = options.bookTtlMs ?? 5_000;
  }

  async fetchQuotes(stocks: StockInfo[]): Promise<Quote[]> {
    const out: Quote[] = [];
    let lastError: unknown;
    // 종목 하나에 한 번씩 호출 (간격 조절은 KisClient가 함)
    for (const s of stocks) {
      if (s.market !== this.market) continue;
      try {
        const q = this.market === 'KR' ? await this.krQuote(s) : await this.usQuote(s);
        if (q) out.push(this.withBook(q));
      } catch (e) {
        if (e instanceof KisBlockedError) throw e;
        lastError = e;
      }
    }
    if (out.length === 0 && lastError) throw lastError;
    return out;
  }

  async fetchCandles(stock: StockInfo, interval: CandleInterval, limit: number): Promise<Candle[]> {
    const p = PERIOD[interval];
    if (!p) throw new UnsupportedError('한투 분봉은 아직 안 써요');
    const candles = this.market === 'KR' ? await this.krDaily(stock, p.kr, p.daysPerBar, limit) : await this.usDaily(stock, p.us, limit);
    if (candles.length === 0) throw new Error('한투 차트 데이터 없음');
    return candles.slice(-limit);
  }

  /** 10단계 호가 (국내만). 1초 안에 다시 부르면 캐시 */
  async fetchOrderBook(stock: StockInfo): Promise<OrderBook | null> {
    if (this.market !== 'KR' || stock.market !== 'KR') return null;
    const hit = this.books.get(stock.code);
    if (hit && this.now() - hit.at < 1_000) return hit.book;
    const res = await this.client.get<KisOrderBookResponse>(PATH.krBook, TR.krBook, { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: stock.code });
    const book = parseKisOrderBook(res, stock.code, this.now());
    if (book) {
      if (this.books.size > 200) this.books.delete(this.books.keys().next().value!);
      this.books.set(stock.code, { book, at: this.now() });
    }
    return book;
  }

  private async krQuote(s: StockInfo): Promise<Quote | null> {
    const res = await this.client.get<KisDomesticPriceResponse>(PATH.krPrice, TR.krPrice, { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: s.code });
    return parseKisDomesticQuote(res.output, s.code, this.now());
  }

  private async usQuote(s: StockInfo): Promise<Quote | null> {
    const excd = US_EXCD[s.exchange];
    // BRK.B 같은 점 들어간 티커는 한투 표기가 확실치 않아서 다음 소스에 맡김
    if (!excd || s.code.includes('.')) return null;
    const res = await this.client.get<KisOverseasPriceResponse>(PATH.usPrice, TR.usPrice, { AUTH: '', EXCD: excd, SYMB: s.code });
    return parseKisOverseasQuote(res.output, s.code, this.now());
  }

  /** 최근에 받은 호가가 있으면 매도·매수 1호가를 시세에 붙임 (시장가 체결에 씀) */
  private withBook(q: Quote): Quote {
    const hit = this.books.get(q.code);
    if (!hit || this.now() - hit.at >= this.bookTtlMs) return q;
    const ask = hit.book.asks[0]?.price;
    const bid = hit.book.bids[0]?.price;
    return ask && bid ? { ...q, ask, bid } : q;
  }

  private async krDaily(stock: StockInfo, period: string, daysPerBar: number, limit: number): Promise<Candle[]> {
    let end = this.now();
    const all: Candle[] = [];
    for (let page = 0; page < MAX_CHART_PAGES && all.length < limit; page++) {
      const start = end - Math.ceil(100 * daysPerBar + 10) * 86_400_000;
      const res = await this.client.get<KisDomesticDailyResponse>(PATH.krDaily, TR.krDaily, {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: stock.code,
        FID_INPUT_DATE_1: kstYmd(start),
        FID_INPUT_DATE_2: kstYmd(end),
        FID_PERIOD_DIV_CODE: period,
        FID_ORG_ADJ_PRC: '0', // 0: 수정주가
      });
      const rows = parseKisDomesticCandles(res.output2);
      if (rows.length === 0) break;
      all.unshift(...rows);
      end = rows[0]!.time * 1000 - 86_400_000;
    }
    return dedupeSort(all);
  }

  private async usDaily(stock: StockInfo, gubn: string, limit: number): Promise<Candle[]> {
    const excd = US_EXCD[stock.exchange];
    if (!excd || stock.code.includes('.')) throw new UnsupportedError('한투 해외 종목코드를 몰라요');
    let bymd = ''; // 빈 값 = 오늘 기준
    const all: Candle[] = [];
    for (let page = 0; page < MAX_CHART_PAGES && all.length < limit; page++) {
      const res = await this.client.get<KisOverseasDailyResponse>(PATH.usDaily, TR.usDaily, {
        AUTH: '',
        EXCD: excd,
        SYMB: stock.code,
        GUBN: gubn,
        BYMD: bymd,
        MODP: '1', // 1: 수정주가 반영
      });
      const rows = parseKisOverseasCandles(res.output2);
      if (rows.length === 0) break;
      all.unshift(...rows);
      bymd = kstYmd(rows[0]!.time * 1000 - 86_400_000);
    }
    return dedupeSort(all);
  }
}

/** 환경변수에 KIS_APP_KEY·KIS_APP_SECRET가 있을 때만 한투 소스 생성 (KIS_ENV=real|paper) */
export function kisFromEnv(env: NodeJS.ProcessEnv, dataDir: string): { KR: KisSource; US: KisSource; env: KisEnv } | null {
  const appKey = env.KIS_APP_KEY?.trim();
  const appSecret = env.KIS_APP_SECRET?.trim();
  if (!appKey || !appSecret) return null;
  const kisEnv: KisEnv = env.KIS_ENV === 'paper' ? 'paper' : 'real';
  const client = new KisClient({ appKey, appSecret, env: kisEnv, tokenFile: join(dataDir, 'kis-token.json') });
  return { KR: new KisSource(client, 'KR'), US: new KisSource(client, 'US'), env: kisEnv };
}
