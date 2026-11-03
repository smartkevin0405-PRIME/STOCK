import type { Candle, CandleInterval, IndexQuote, Quote, SourceStatus, StockInfo } from '@stock/shared';

/** 시세 소스 하나 (네이버, 야후 등). 한 시장만 담당 */
export interface QuoteSource {
  readonly name: string;
  /** 시세 지연 (분). 0이면 실시간 */
  readonly delayMinutes: number;
  /** 여러 종목 현재가. 못 찾은 종목은 빠질 수 있음 */
  fetchQuotes(stocks: StockInfo[]): Promise<Quote[]>;
  fetchCandles(stock: StockInfo, interval: CandleInterval, limit: number): Promise<Candle[]>;
  /** 기간 지정 일봉 (리플레이용, 없어도 됨) */
  fetchHistory?(stock: StockInfo, from: number, to: number): Promise<Candle[]>;
}

/** 지수·환율 소스 */
export interface MarketExtrasSource {
  readonly name: string;
  fetchIndices(): Promise<IndexQuote[]>;
  fetchUsdKrw(): Promise<number>;
}

/** 소스가 원래 제공하지 않는 데이터 (실패로 치지 않고 다음 소스로 넘김) */
export class UnsupportedError extends Error {}

export interface FallbackOptions {
  /** 연속 몇 번 실패하면 잠시 건너뛸지 */
  failureThreshold?: number;
  /** 건너뛰는 시간 (ms). 지나면 다시 시도 */
  cooldownMs?: number;
  now?: () => number;
}

type Op = 'quotes' | 'candles';

interface Health {
  failures: number;
  cooldownUntil: number;
}

/**
 * 여러 소스를 순서대로 시도. 앞 소스가 계속 실패하면 잠시 건너뛰고 다음 소스 사용.
 * 예: [네이버, 야후] → 네이버가 막히면 야후(20분 지연)로 자동 전환, 1분 뒤 네이버 재시도.
 * 시세는 종목 단위로도 넘김: 네이버가 못 준 종목만 야후에 요청.
 */
export class FallbackSource implements QuoteSource {
  readonly name: string;
  private readonly health = new Map<string, Health>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private lastServed: QuoteSource;
  private lastOk = true;

  constructor(
    private readonly sources: QuoteSource[],
    options: FallbackOptions = {},
  ) {
    if (sources.length === 0) throw new Error('시세 소스가 하나 이상 필요해요');
    this.name = sources.map((s) => s.name).join('>');
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.lastServed = sources[0]!;
  }

  get delayMinutes(): number {
    return this.lastServed.delayMinutes;
  }

  status(): SourceStatus {
    return { source: this.lastServed.name, delayMinutes: this.lastServed.delayMinutes, ok: this.lastOk };
  }

  async fetchQuotes(stocks: StockInfo[]): Promise<Quote[]> {
    let remaining = stocks;
    const out: Quote[] = [];
    const errors: unknown[] = [];
    let served: QuoteSource | undefined;

    for (const s of this.candidates('quotes')) {
      if (remaining.length === 0) break;
      try {
        const quotes = await s.fetchQuotes(remaining);
        this.markOk(s, 'quotes');
        if (quotes.length === 0) continue;
        served ??= s;
        const got = new Set(quotes.map((q) => q.code));
        out.push(...quotes.map((q) => ({ ...q, delayMinutes: q.delayMinutes ?? s.delayMinutes })));
        remaining = remaining.filter((r) => !got.has(r.code));
      } catch (e) {
        errors.push(e);
        if (!(e instanceof UnsupportedError)) this.markFail(s, 'quotes');
      }
    }

    if (served) {
      this.lastServed = served;
      this.lastOk = true;
    } else if (errors.length > 0) {
      this.lastOk = false;
      throw new AggregateError(errors, `모든 시세 소스 실패 (${this.name})`);
    }
    return out;
  }

  async fetchCandles(stock: StockInfo, interval: CandleInterval, limit: number): Promise<Candle[]> {
    const errors: unknown[] = [];
    for (const s of this.candidates('candles')) {
      try {
        const candles = await s.fetchCandles(stock, interval, limit);
        this.markOk(s, 'candles');
        return candles;
      } catch (e) {
        errors.push(e);
        if (!(e instanceof UnsupportedError)) this.markFail(s, 'candles');
      }
    }
    throw new AggregateError(errors, `차트를 불러오지 못했어요 (${this.name})`);
  }

  async fetchHistory(stock: StockInfo, from: number, to: number): Promise<Candle[]> {
    const errors: unknown[] = [];
    for (const s of this.candidates('candles')) {
      if (!s.fetchHistory) continue;
      try {
        const candles = await s.fetchHistory(stock, from, to);
        this.markOk(s, 'candles');
        return candles;
      } catch (e) {
        errors.push(e);
        if (!(e instanceof UnsupportedError)) this.markFail(s, 'candles');
      }
    }
    throw new AggregateError(errors, `과거 시세를 불러오지 못했어요 (${this.name})`);
  }

  private key(s: QuoteSource, op: Op): string {
    return `${s.name}:${op}`;
  }

  /** 쉬는 중이 아닌 소스부터 순서대로. 전부 쉬는 중이면 전부 시도 */
  private candidates(op: Op): QuoteSource[] {
    const now = this.now();
    const ready = this.sources.filter((s) => (this.health.get(this.key(s, op))?.cooldownUntil ?? 0) <= now);
    return ready.length > 0 ? ready : this.sources;
  }

  private markOk(s: QuoteSource, op: Op): void {
    this.health.delete(this.key(s, op));
  }

  private markFail(s: QuoteSource, op: Op): void {
    const k = this.key(s, op);
    const h = this.health.get(k) ?? { failures: 0, cooldownUntil: 0 };
    h.failures += 1;
    if (h.failures >= this.failureThreshold) h.cooldownUntil = this.now() + this.cooldownMs;
    this.health.set(k, h);
  }
}
