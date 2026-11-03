import { isMarketOpen } from '@stock/core';
import type { Candle, CandleInterval, DataStatus, IndexQuote, Market, Quote, RankingItem, RankingType, StockInfo } from '@stock/shared';
import type { StockDirectory } from './directory';
import type { MarketDataProvider } from './provider';
import { sortRankings } from './rankings';
import type { FallbackSource, MarketExtrasSource } from './sources';

export interface LiveProviderOptions {
  directory: StockDirectory;
  sources: Record<Market, FallbackSource>;
  extras: MarketExtrasSource;
  /** 시장별 순위 (네이버) */
  rankings?: (type: RankingType, market: Market) => Promise<RankingItem[]>;
  /** 화면에 보이는 종목 갱신 간격 */
  watchIntervalMs?: number;
  /** 지수·환율 갱신 간격 */
  extrasIntervalMs?: number;
  /** 이 시간 안에 받은 시세는 다시 요청 안 함 */
  quoteTtlMs?: number;
  /** 한 번에 요청할 최대 종목 수 */
  batchSize?: number;
  /** 장이 닫힌 시장의 종목은 이 간격으로만 갱신 */
  closedIntervalMs?: number;
  /** 순위 캐시 시간 */
  rankingTtlMs?: number;
  now?: () => number;
}

interface Cached<T> {
  value: T;
  at: number;
}

const CANDLE_TTL: Record<CandleInterval, number> = {
  '1m': 20_000, '5m': 60_000, '15m': 60_000, '60m': 120_000,
  '1d': 300_000, '1w': 600_000, '1M': 600_000,
};

/**
 * 실제 시세 공급자.
 * - 화면에 보이는 종목만 짧은 간격으로 조회 (요청 수 최소화 → 차단 위험 줄임)
 * - 받은 시세는 잠깐 캐시, 실패하면 마지막 시세 유지
 * - 가격이 바뀐 종목만 실시간으로 앱에 전달
 */
export class LiveProvider implements MarketDataProvider {
  readonly name = 'live';
  private readonly quotes = new Map<string, Cached<Quote>>();
  private readonly candles = new Map<string, Cached<Candle[]>>();
  private readonly listeners = new Set<(q: Quote) => void>();
  private watched = new Set<string>();
  private indices: Cached<IndexQuote[]> | undefined;
  private usdKrw: Cached<number> | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private polling = false;

  private readonly rankingCache = new Map<string, Cached<RankingItem[]>>();
  private readonly o: Required<Omit<LiveProviderOptions, 'directory' | 'sources' | 'extras' | 'rankings'>>;

  constructor(private readonly opts: LiveProviderOptions) {
    this.o = {
      watchIntervalMs: opts.watchIntervalMs ?? 3_000,
      extrasIntervalMs: opts.extrasIntervalMs ?? 30_000,
      quoteTtlMs: opts.quoteTtlMs ?? 2_500,
      batchSize: opts.batchSize ?? 20,
      closedIntervalMs: opts.closedIntervalMs ?? 60_000,
      rankingTtlMs: opts.rankingTtlMs ?? 15_000,
      now: opts.now ?? Date.now,
    };
  }

  async start(): Promise<void> {
    if (this.timers.length) return;
    await this.refreshExtras().catch(() => undefined);
    this.timers.push(
      setInterval(() => void this.pollWatched(), this.o.watchIntervalMs),
      setInterval(() => void this.refreshExtras().catch(() => undefined), this.o.extrasIntervalMs),
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  status(): DataStatus {
    return { provider: 'live', KR: this.opts.sources.KR.status(), US: this.opts.sources.US.status() };
  }

  watch(codes: Iterable<string>): void {
    this.watched = new Set(codes);
  }

  onQuote(listener: (q: Quote) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async listStocks(): Promise<StockInfo[]> {
    return this.opts.directory.list();
  }

  async getStock(code: string): Promise<StockInfo | undefined> {
    return this.opts.directory.get(code);
  }

  async getQuotes(codes: string[]): Promise<Quote[]> {
    const now = this.o.now();
    const stale = codes.filter((c) => {
      const hit = this.quotes.get(c);
      return !hit || now - hit.at >= this.o.quoteTtlMs;
    });
    if (stale.length) await this.fetchAndStore(stale);
    return codes.flatMap((c) => {
      const hit = this.quotes.get(c);
      return hit ? [hit.value] : [];
    });
  }

  async getCandles(code: string, interval: CandleInterval, limit: number): Promise<Candle[]> {
    const stock = this.opts.directory.get(code);
    if (!stock) return [];
    const key = `${code}:${interval}`;
    const hit = this.candles.get(key);
    const now = this.o.now();
    if (hit && now - hit.at < CANDLE_TTL[interval] && hit.value.length >= limit) return hit.value.slice(-limit);
    try {
      const value = await this.opts.sources[stock.market].fetchCandles(stock, interval, limit);
      this.candles.set(key, { value, at: now });
      return value.slice(-limit);
    } catch (e) {
      if (hit) return hit.value.slice(-limit);
      throw e;
    }
  }

  async getRankings(type: RankingType, market?: Market): Promise<RankingItem[]> {
    if (!this.opts.rankings) return [];
    const key = `${type}:${market ?? 'ALL'}`;
    const now = this.o.now();
    const hit = this.rankingCache.get(key);
    if (hit && now - hit.at < this.o.rankingTtlMs) return hit.value;

    const markets: Market[] = market ? [market] : ['KR', 'US'];
    const lists = await Promise.allSettled(markets.map((m) => this.opts.rankings!(type, m)));
    const items = lists.flatMap((l) => (l.status === 'fulfilled' ? l.value : []));
    if (items.length === 0 && lists.some((l) => l.status === 'rejected')) {
      if (hit) return hit.value;
      throw new Error('순위를 불러오지 못했어요');
    }
    const usdKrw = this.usdKrw?.value ?? 1_400;
    const value = sortRankings(
      items.map((x) => ({ stock: this.opts.directory.add(x.stock), quote: x.quote })),
      type,
      usdKrw,
    );
    for (const x of value) this.store(x.quote);
    this.rankingCache.set(key, { value, at: now });
    return value;
  }

  async getIndices(): Promise<IndexQuote[]> {
    if (!this.indices) await this.refreshExtras().catch(() => undefined);
    return this.indices?.value ?? [];
  }

  async getUsdKrw(): Promise<number> {
    if (!this.usdKrw) await this.refreshExtras().catch(() => undefined);
    const rate = this.usdKrw?.value;
    if (!rate) throw new Error('환율을 불러오지 못했어요');
    return rate;
  }

  /** 화면에 보이는 종목 갱신 (테스트에서 직접 호출 가능) */
  async pollWatched(): Promise<void> {
    if (this.polling || this.watched.size === 0) return;
    this.polling = true;
    try {
      // 장이 닫힌 시장은 가격이 거의 안 변하니 1분에 한 번만
      const now = this.o.now();
      const open: Record<Market, boolean> = { KR: isMarketOpen('KR', now), US: isMarketOpen('US', now) };
      const due = [...this.watched].filter((code) => {
        const market = this.opts.directory.get(code)?.market;
        if (!market || open[market]) return true;
        const at = this.quotes.get(code)?.at ?? 0;
        return now - at >= this.o.closedIntervalMs;
      });
      if (due.length) await this.fetchAndStore(due);
    } finally {
      this.polling = false;
    }
  }

  async refreshExtras(): Promise<void> {
    const now = this.o.now();
    const [indices, usdKrw] = await Promise.allSettled([this.opts.extras.fetchIndices(), this.opts.extras.fetchUsdKrw()]);
    if (indices.status === 'fulfilled') this.indices = { value: indices.value, at: now };
    if (usdKrw.status === 'fulfilled') this.usdKrw = { value: usdKrw.value, at: now };
    if (indices.status === 'rejected' && usdKrw.status === 'rejected') throw indices.reason;
  }

  /** 시장별로 나눠서 묶음 요청. 실패한 묶음은 마지막 시세 유지 */
  private async fetchAndStore(codes: string[]): Promise<void> {
    const byMarket: Record<Market, StockInfo[]> = { KR: [], US: [] };
    for (const c of codes) {
      const s = this.opts.directory.get(c);
      if (s) byMarket[s.market].push(s);
    }
    const jobs: Promise<void>[] = [];
    for (const market of ['KR', 'US'] as const) {
      const list = byMarket[market];
      for (let i = 0; i < list.length; i += this.o.batchSize) {
        const batch = list.slice(i, i + this.o.batchSize);
        jobs.push(
          this.opts.sources[market].fetchQuotes(batch).then(
            (qs) => qs.forEach((q) => this.store(q)),
            () => undefined,
          ),
        );
      }
    }
    await Promise.all(jobs);
  }

  private store(q: Quote): void {
    const prev = this.quotes.get(q.code)?.value;
    this.quotes.set(q.code, { value: q, at: this.o.now() });
    const changed = !prev || prev.price !== q.price || prev.volume !== q.volume || prev.delayMinutes !== q.delayMinutes;
    if (changed) for (const l of this.listeners) l(q);
  }
}
