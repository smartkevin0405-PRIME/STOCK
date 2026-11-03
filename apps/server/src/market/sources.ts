import type { Candle, CandleInterval, IndexQuote, Quote, SourceStatus, StockInfo } from '@stock/shared';

/** 시세 소스 하나 (네이버, 야후 등). 한 시장만 담당 */
export interface QuoteSource {
  readonly name: string;
  /** 시세 지연 (분). 0이면 실시간 */
  readonly delayMinutes: number;
  /** 여러 종목 현재가. 못 찾은 종목은 빠질 수 있음 */
  fetchQuotes(stocks: StockInfo[]): Promise<Quote[]>;
  fetchCandles(stock: StockInfo, interval: CandleInterval, limit: number): Promise<Candle[]>;
}

/** 지수·환율 소스 */
export interface MarketExtrasSource {
  readonly name: string;
  fetchIndices(): Promise<IndexQuote[]>;
  fetchUsdKrw(): Promise<number>;
}

export interface FallbackOptions {
  /** 연속 몇 번 실패하면 잠시 건너뛸지 */
  failureThreshold?: number;
  /** 건너뛰는 시간 (ms). 지나면 다시 시도 */
  cooldownMs?: number;
  now?: () => number;
}

interface Health {
  failures: number;
  cooldownUntil: number;
}

/**
 * 여러 소스를 순서대로 시도. 앞 소스가 계속 실패하면 잠시 건너뛰고 다음 소스 사용.
 * 예: [네이버, 야후] → 네이버가 막히면 야후(20분 지연)로 자동 전환, 1분 뒤 네이버 재시도.
 */
export class FallbackSource implements QuoteSource {
  readonly name: string;
  private readonly health = new Map<QuoteSource, Health>();
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
    for (const s of sources) this.health.set(s, { failures: 0, cooldownUntil: 0 });
    this.lastServed = sources[0]!;
  }

  get delayMinutes(): number {
    return this.lastServed.delayMinutes;
  }

  status(): SourceStatus {
    return { source: this.lastServed.name, delayMinutes: this.lastServed.delayMinutes, ok: this.lastOk };
  }

  fetchQuotes(stocks: StockInfo[]): Promise<Quote[]> {
    return this.run((s) => s.fetchQuotes(stocks)).then(([quotes, s]) =>
      quotes.map((q) => ({ ...q, delayMinutes: q.delayMinutes ?? s.delayMinutes })),
    );
  }

  fetchCandles(stock: StockInfo, interval: CandleInterval, limit: number): Promise<Candle[]> {
    return this.run((s) => s.fetchCandles(stock, interval, limit)).then(([candles]) => candles);
  }

  /** 쉬는 중이 아닌 소스부터 순서대로. 전부 쉬는 중이면 전부 시도 */
  private candidates(): QuoteSource[] {
    const now = this.now();
    const ready = this.sources.filter((s) => this.health.get(s)!.cooldownUntil <= now);
    return ready.length > 0 ? ready : this.sources;
  }

  private async run<T>(fn: (s: QuoteSource) => Promise<T>): Promise<[T, QuoteSource]> {
    const errors: unknown[] = [];
    for (const s of this.candidates()) {
      try {
        const result = await fn(s);
        this.health.set(s, { failures: 0, cooldownUntil: 0 });
        this.lastServed = s;
        this.lastOk = true;
        return [result, s];
      } catch (e) {
        errors.push(e);
        const h = this.health.get(s)!;
        h.failures += 1;
        if (h.failures >= this.failureThreshold) h.cooldownUntil = this.now() + this.cooldownMs;
      }
    }
    this.lastOk = false;
    throw new AggregateError(errors, `모든 시세 소스 실패 (${this.name})`);
  }
}
