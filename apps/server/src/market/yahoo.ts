import type { Candle, CandleInterval, IndexQuote, Market, Quote, StockInfo } from '@stock/shared';
import { fetchJson } from './http';
import type { QuoteSource } from './sources';

// 야후 파이낸스 비공식 API. 한국주식은 약 20분 지연.

interface Meta {
  symbol?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketTime?: number;
  gmtoffset?: number;
}

interface SparkResponse {
  spark?: { result?: { symbol: string; response?: { meta?: Meta }[] }[] };
}

interface ChartResponse {
  chart?: {
    result?: {
      meta?: Meta;
      timestamp?: number[];
      indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }[] };
    }[];
    error?: { description?: string } | null;
  };
}

/** 우리 종목코드 → 야후 심볼 (005930 → 005930.KS, BRK.B → BRK-B) */
export function yahooSymbol(stock: Pick<StockInfo, 'code' | 'market' | 'exchange'>): string {
  if (stock.market === 'KR') return `${stock.code}.${stock.exchange === 'KOSDAQ' ? 'KQ' : 'KS'}`;
  return stock.code.replace(/\./g, '-');
}

export function parseYahooMeta(m: Meta, code: string, delayMinutes: number): Quote | null {
  const price = m.regularMarketPrice;
  const prevClose = m.previousClose ?? m.chartPreviousClose;
  if (!price || !prevClose) return null;
  const change = price - prevClose;
  return {
    code,
    price,
    prevClose,
    high: m.regularMarketDayHigh,
    low: m.regularMarketDayLow,
    volume: m.regularMarketVolume ?? 0,
    change: Math.round(change * 10_000) / 10_000,
    changeRate: change / prevClose,
    timestamp: (m.regularMarketTime ?? Date.now() / 1000) * 1000,
    delayMinutes,
  };
}

/** 여러 심볼 현재가 한 번에 (spark). 없는 심볼은 빠짐 */
export async function fetchYahooMetas(symbols: string[]): Promise<Map<string, Meta>> {
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${symbols.map(encodeURIComponent).join(',')}&range=1d&interval=1d`;
  const res = await fetchJson<SparkResponse>(url);
  const results = res.spark?.result;
  if (!Array.isArray(results)) throw new Error('야후 시세 형식이 바뀌었어요');
  const out = new Map<string, Meta>();
  for (const r of results) {
    const meta = r.response?.[0]?.meta;
    if (meta) out.set(r.symbol, meta);
  }
  return out;
}

const YAHOO_PERIOD: Record<CandleInterval, { interval: string; range: string; daily: boolean }> = {
  '1m': { interval: '1m', range: '5d', daily: false },
  '5m': { interval: '5m', range: '1mo', daily: false },
  '15m': { interval: '15m', range: '1mo', daily: false },
  '60m': { interval: '60m', range: '3mo', daily: false },
  '1d': { interval: '1d', range: '2y', daily: true },
  '1w': { interval: '1wk', range: '10y', daily: true },
  '1M': { interval: '1mo', range: 'max', daily: true },
};

export function parseYahooChart(res: ChartResponse, daily: boolean): Candle[] {
  const r = res.chart?.result?.[0];
  if (!r) throw new Error(res.chart?.error?.description ?? '야후 차트 형식이 바뀌었어요');
  const ts = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const offset = r.meta?.gmtoffset ?? 0;
  // 야후는 338.489990234375 같은 부동소수를 줘서 소수 4자리로 정리
  const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
  const out: Candle[] = [];
  ts.forEach((t, i) => {
    const close = q.close?.[i];
    if (close === null || close === undefined) return;
    out.push({
      // 일봉 이상은 현지 날짜의 UTC 0시로 맞춤 (네이버·가짜 시세와 같은 기준)
      time: daily ? Math.floor((t + offset) / 86_400) * 86_400 : t,
      open: r4(q.open?.[i] ?? close),
      high: r4(q.high?.[i] ?? close),
      low: r4(q.low?.[i] ?? close),
      close: r4(close),
      volume: q.volume?.[i] ?? 0,
    });
  });
  // 같은 날짜가 두 번 나오면(장중 갱신분) 마지막 것만
  return out.filter((c, i) => i === out.length - 1 || out[i + 1]!.time !== c.time);
}

/** 야후 시세. 한국은 20분 지연, 미국은 실시간에 가까움 */
export class YahooSource implements QuoteSource {
  readonly name = 'yahoo';
  readonly delayMinutes: number;

  constructor(market: Market) {
    this.delayMinutes = market === 'KR' ? 20 : 0;
  }

  async fetchQuotes(stocks: StockInfo[]): Promise<Quote[]> {
    if (stocks.length === 0) return [];
    const bySymbol = new Map(stocks.map((s) => [yahooSymbol(s), s.code]));
    const metas = await fetchYahooMetas([...bySymbol.keys()]);
    return [...metas].flatMap(([symbol, meta]) => {
      const code = bySymbol.get(symbol);
      const q = code ? parseYahooMeta(meta, code, this.delayMinutes) : null;
      return q ? [q] : [];
    });
  }

  async fetchCandles(stock: StockInfo, interval: CandleInterval, limit: number): Promise<Candle[]> {
    const p = YAHOO_PERIOD[interval];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(stock))}?interval=${p.interval}&range=${p.range}`;
    const candles = parseYahooChart(await fetchJson<ChartResponse>(url, 12_000), p.daily);
    if (candles.length === 0) throw new Error('야후 차트 데이터 없음');
    return candles.slice(-limit);
  }
}

export const YAHOO_INDICES = [
  { symbol: '^KS11', name: '코스피' },
  { symbol: '^KQ11', name: '코스닥' },
  { symbol: '^IXIC', name: '나스닥' },
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: 'KRW=X', name: '원/달러' },
] as const;

export function metaToIndex(symbol: string, name: string, m: Meta): IndexQuote | null {
  const q = parseYahooMeta(m, symbol, 0);
  return q ? { symbol, name, price: q.price, change: q.change, changeRate: q.changeRate } : null;
}
