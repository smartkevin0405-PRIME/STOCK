import { priceLimits, roundToTick } from '@stock/core';
import type { Candle, CandleInterval, DataStatus, IndexQuote, Market, Quote, RankingItem, RankingType, StockInfo } from '@stock/shared';
import { aggregateCandles, byMinutes, byMonth, byWeek } from './candles';
import { MOCK_INDICES, MOCK_STOCKS } from './mockStocks';
import type { MarketDataProvider } from './provider';
import { sortRankings } from './rankings';

type Rng = () => number;

function seedOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): Rng {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const MINUTES_PER_DAY = 390;
const HISTORY_DAYS = 400;
const MAX_MINUTES = 3_000;

interface Series {
  stock: StockInfo;
  volatility: number;
  rng: Rng;
  prevClose: number;
  daily: Candle[];
  today: Candle;
  minutes: Candle[];
}

interface IndexSeries {
  symbol: string;
  name: string;
  prevClose: number;
  price: number;
  volatility: number;
  rng: Rng;
}

export interface MockProviderOptions {
  /** 시세 갱신 간격 (ms) */
  tickMs?: number;
  now?: () => number;
}

/** 가짜 시세: 종목별로 고정된 랜덤 히스토리 + 실시간 랜덤워크. 장 시간과 무관하게 24시간 움직임 */
export class MockProvider implements MarketDataProvider {
  readonly name = 'mock';

  private readonly series = new Map<string, Series>();
  private readonly indices = new Map<string, IndexSeries>();
  private readonly listeners = new Set<(q: Quote) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly tickMs: number;
  private readonly now: () => number;

  constructor(options: MockProviderOptions = {}) {
    this.tickMs = options.tickMs ?? 1_000;
    this.now = options.now ?? Date.now;
    for (const s of MOCK_STOCKS) this.series.set(s.code, this.createSeries(s));
    for (const idx of MOCK_INDICES) {
      const rng = mulberry32(seedOf(idx.symbol));
      const prevClose = idx.base;
      const price = round2(prevClose * (1 + gauss(rng) * idx.volatility * 0.5));
      this.indices.set(idx.symbol, { symbol: idx.symbol, name: idx.name, prevClose, price, volatility: idx.volatility, rng });
    }
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  status(): DataStatus {
    const s = { source: 'mock', delayMinutes: 0, ok: true };
    return { provider: 'mock', KR: s, US: s };
  }

  /** 가짜 시세는 전 종목이 항상 움직여서 따로 할 일 없음 */
  watch(): void {}

  async listStocks(): Promise<StockInfo[]> {
    return [...this.series.values()].map((s) => s.stock);
  }

  async getStock(code: string): Promise<StockInfo | undefined> {
    return this.series.get(code)?.stock;
  }

  async getQuotes(codes: string[]): Promise<Quote[]> {
    return codes.flatMap((c) => {
      const s = this.series.get(c);
      return s ? [this.toQuote(s)] : [];
    });
  }

  async getCandles(code: string, interval: CandleInterval, limit: number): Promise<Candle[]> {
    const s = this.series.get(code);
    if (!s) return [];
    const days = [...s.daily, s.today];
    let out: Candle[];
    switch (interval) {
      case '1m': out = s.minutes; break;
      case '5m': out = aggregateCandles(s.minutes, byMinutes(5)); break;
      case '15m': out = aggregateCandles(s.minutes, byMinutes(15)); break;
      case '60m': out = aggregateCandles(s.minutes, byMinutes(60)); break;
      case '1d': out = days; break;
      case '1w': out = aggregateCandles(days, byWeek); break;
      case '1M': out = aggregateCandles(days, byMonth); break;
    }
    return out.slice(-limit).map((c) => ({ ...c }));
  }

  async getRankings(type: RankingType, market?: Market): Promise<RankingItem[]> {
    const items = [...this.series.values()]
      .filter((s) => !market || s.stock.market === market)
      .map((s) => ({ stock: s.stock, quote: this.toQuote(s) }));
    return sortRankings(items, type, await this.getUsdKrw());
  }

  async getIndices(): Promise<IndexQuote[]> {
    return [...this.indices.values()].map((i) => ({
      symbol: i.symbol,
      name: i.name,
      price: i.price,
      change: round2(i.price - i.prevClose),
      changeRate: (i.price - i.prevClose) / i.prevClose,
    }));
  }

  async getUsdKrw(): Promise<number> {
    return this.indices.get('KRW=X')?.price ?? 1_400;
  }

  /** 가짜 과거 일봉: 종목·시작일로 고정된 랜덤워크 (같은 요청엔 항상 같은 결과) */
  async getHistory(code: string, from: number, to: number): Promise<Candle[]> {
    const s = this.series.get(code);
    if (!s) return [];
    return syntheticDaily(`${code}:${from}`, s.prevClose, s.volatility, from, to, (p) =>
      roundToTick(s.stock.market, Math.max(p, s.stock.market === 'US' ? 0.01 : 1), 'nearest'),
    );
  }

  async getIndexHistory(symbol: string, from: number, to: number): Promise<Candle[]> {
    const idx = this.indices.get(symbol);
    if (!idx) return [];
    return syntheticDaily(`${symbol}:${from}`, idx.prevClose, idx.volatility, from, to, round2);
  }

  onQuote(listener: (q: Quote) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 한 번 시세를 움직임 (테스트에서 직접 호출 가능) */
  tick(): void {
    const nowMs = this.now();
    const minuteTime = Math.floor(nowMs / 60_000) * 60;
    // 하루 변동성을 1초 단위로 쪼갠 뒤, 화면에서 움직임이 보이도록 키움
    const perTick = Math.sqrt(this.tickMs / 1_000 / (MINUTES_PER_DAY * 60)) * 3;

    for (const s of this.series.values()) {
      if (s.rng() < 0.4) continue;
      const last = s.today.close;
      const next = this.clampPrice(s, last * (1 + gauss(s.rng) * s.volatility * perTick));
      const vol = Math.floor(s.rng() * 40) + 1;
      this.applyPrice(s, next, vol, minuteTime);
      const q = this.toQuote(s, nowMs);
      for (const l of this.listeners) l(q);
    }

    for (const i of this.indices.values()) {
      i.price = round2(i.price * (1 + gauss(i.rng) * i.volatility * perTick * 0.5));
    }
  }

  private createSeries(def: (typeof MOCK_STOCKS)[number]): Series {
    const { basePrice, volatility, ...stock } = def;
    const market = stock.market;
    const rng = mulberry32(seedOf(stock.code));
    const tick = (p: number) => roundToTick(market, Math.max(p, market === 'US' ? 0.01 : 1), 'nearest');

    // 오늘 이전 평일 HISTORY_DAYS일, 마지막 종가가 기준가가 되도록 거꾸로 생성
    const nowMs = this.now();
    const todayUtc = Math.floor(nowMs / 86_400_000) * 86_400;
    const dates: number[] = [];
    for (let t = todayUtc - 86_400; dates.length < HISTORY_DAYS; t -= 86_400) {
      const dow = new Date(t * 1000).getUTCDay();
      if (dow !== 0 && dow !== 6) dates.unshift(t);
    }
    const closes: number[] = new Array(HISTORY_DAYS);
    closes[HISTORY_DAYS - 1] = basePrice;
    for (let i = HISTORY_DAYS - 1; i > 0; i--) {
      closes[i - 1] = closes[i]! / (1 + gauss(rng) * volatility);
    }
    const daily: Candle[] = dates.map((time, i) => {
      const close = tick(closes[i]!);
      const prev = i > 0 ? closes[i - 1]! : close;
      const open = tick(prev * (1 + gauss(rng) * volatility * 0.3));
      const high = tick(Math.max(open, close) * (1 + Math.abs(gauss(rng)) * volatility * 0.4));
      const low = tick(Math.min(open, close) * (1 - Math.abs(gauss(rng)) * volatility * 0.4));
      return { time, open, high, low, close, volume: Math.floor((0.5 + rng()) * 1_000_000) };
    });

    const prevClose = daily[daily.length - 1]!.close;
    const series: Series = {
      stock,
      volatility,
      rng,
      prevClose,
      daily,
      today: { time: todayUtc, open: prevClose, high: prevClose, low: prevClose, close: prevClose, volume: 0 },
      minutes: [],
    };

    // 오늘 1분봉: 지금부터 거꾸로 390분
    const nowMinute = Math.floor(nowMs / 60_000) * 60;
    const open = this.clampPrice(series, prevClose * (1 + gauss(rng) * volatility * 0.3));
    series.today = { time: todayUtc, open, high: open, low: open, close: open, volume: 0 };
    const perMinute = volatility / Math.sqrt(MINUTES_PER_DAY);
    let price = open;
    for (let m = MINUTES_PER_DAY - 1; m >= 0; m--) {
      price = this.clampPrice(series, price * (1 + gauss(rng) * perMinute));
      // 하루 거래량이 과거 일봉과 비슷한 규모가 되도록
      this.applyPrice(series, price, Math.floor(rng() * 2_500), nowMinute - m * 60);
    }
    return series;
  }

  private clampPrice(s: Series, raw: number): number {
    const market = s.stock.market;
    let p = roundToTick(market, Math.max(raw, market === 'US' ? 0.0001 : 1), 'nearest');
    const limits = priceLimits(market, s.prevClose);
    if (limits) p = Math.min(limits.upper, Math.max(limits.lower, p));
    return p;
  }

  private applyPrice(s: Series, price: number, volume: number, minuteTime: number): void {
    const last = s.minutes[s.minutes.length - 1];
    if (last && last.time === minuteTime) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume += volume;
    } else {
      const open = last?.close ?? price;
      s.minutes.push({
        time: minuteTime,
        open,
        high: Math.max(open, price),
        low: Math.min(open, price),
        close: price,
        volume,
      });
      if (s.minutes.length > MAX_MINUTES) s.minutes.splice(0, s.minutes.length - MAX_MINUTES);
    }
    const t = s.today;
    t.high = Math.max(t.high, price);
    t.low = Math.min(t.low, price);
    t.close = price;
    t.volume += volume;
  }

  private toQuote(s: Series, timestamp = this.now()): Quote {
    const price = s.today.close;
    return {
      code: s.stock.code,
      price,
      prevClose: s.prevClose,
      open: s.today.open,
      high: s.today.high,
      low: s.today.low,
      volume: s.today.volume,
      change: s.stock.market === 'US' ? Number((price - s.prevClose).toFixed(4)) : price - s.prevClose,
      changeRate: (price - s.prevClose) / s.prevClose,
      timestamp,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 평일만, base 근처에서 시작하는 랜덤워크 일봉 */
function syntheticDaily(seed: string, base: number, volatility: number, from: number, to: number, round: (p: number) => number): Candle[] {
  const rng = mulberry32(seedOf(seed));
  const out: Candle[] = [];
  let price = base * (0.7 + rng() * 0.6);
  for (let t = Math.floor(from / 86_400_000) * 86_400; t * 1000 <= to; t += 86_400) {
    const dow = new Date(t * 1000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const open = round(price * (1 + gauss(rng) * volatility * 0.3));
    price = price * (1 + gauss(rng) * volatility);
    const close = round(price);
    out.push({
      time: t,
      open,
      high: round(Math.max(open, close) * (1 + Math.abs(gauss(rng)) * volatility * 0.4)),
      low: round(Math.min(open, close) * (1 - Math.abs(gauss(rng)) * volatility * 0.4)),
      close,
      volume: Math.floor((0.5 + rng()) * 1_000_000),
    });
  }
  return out;
}
