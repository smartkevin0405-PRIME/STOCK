import type { Candle, CandleInterval, Exchange, IndexQuote, Market, Quote, RankingItem, RankingType, StockInfo } from '@stock/shared';
import { currencyOf } from '@stock/shared';
import { aggregateCandles, byMinutes } from './candles';
import { fetchJson, kstStamp, num, sleep } from './http';
import { UnsupportedError, type QuoteSource } from './sources';

// 네이버 증권 비공식 API. 형식이 바뀌거나 막힐 수 있어서 파싱은 방어적으로.

interface NaverItem {
  itemCode?: string | null;
  symbolCode?: string;
  reutersCode?: string;
  stockName?: string;
  stockNameEng?: string;
  stockEndType?: string;
  closePrice?: string;
  closePriceRaw?: string;
  compareToPreviousClosePrice?: string;
  compareToPreviousClosePriceRaw?: string;
  compareToPreviousPrice?: { code?: string };
  fluctuationsRatio?: string;
  openPrice?: string;
  highPrice?: string;
  lowPrice?: string;
  accumulatedTradingVolume?: string;
  accumulatedTradingVolumeRaw?: string;
  localTradedAt?: string;
  marketStatus?: string;
  stockExchangeType?: { name?: string; code?: string; delayTime?: number };
}

interface PollResponse {
  datas?: NaverItem[];
}

interface ListResponse {
  totalCount?: number;
  stocks?: NaverItem[];
}

interface NaverCandle {
  localDate?: string;
  localDateTime?: string;
  openPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  closePrice?: number;
  currentPrice?: number;
  accumulatedTradingVolume?: number;
}

const KR_EXCHANGES: Record<string, Exchange> = { KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ' };
const US_EXCHANGES: Record<string, Exchange> = { NASDAQ: 'NASDAQ', NYSE: 'NYSE', AMEX: 'AMEX' };

/** 네이버 미국 종목코드 "BRK B" → "BRK.B" */
function usCode(symbolCode: string): string {
  return symbolCode.trim().replace(/\s+/g, '.');
}

/** 네이버 시세 항목 → Quote. 가격을 못 읽으면 null */
export function parseNaverQuote(x: NaverItem, code: string): Quote | null {
  const price = num(x.closePriceRaw) ?? num(x.closePrice);
  if (price === undefined || price <= 0) return null;
  let change = num(x.compareToPreviousClosePriceRaw) ?? num(x.compareToPreviousClosePrice) ?? 0;
  // 등락 코드: 1 상한, 2 상승, 3 보합, 4 하한, 5 하락 — 부호 없이 올 때 대비
  const dir = x.compareToPreviousPrice?.code;
  if ((dir === '4' || dir === '5') && change > 0) change = -change;
  const prevClose = price - change;
  const ts = x.localTradedAt ? Date.parse(x.localTradedAt) : NaN;
  return {
    code,
    price,
    prevClose,
    open: num(x.openPrice),
    high: num(x.highPrice),
    low: num(x.lowPrice),
    volume: num(x.accumulatedTradingVolumeRaw) ?? num(x.accumulatedTradingVolume) ?? 0,
    change,
    changeRate: prevClose > 0 ? change / prevClose : 0,
    timestamp: Number.isFinite(ts) ? ts : Date.now(),
    delayMinutes: x.stockExchangeType?.delayTime ?? 0,
    ...(x.marketStatus === 'OPEN' ? { marketStatus: 'open' as const } : x.marketStatus === 'CLOSE' ? { marketStatus: 'closed' as const } : {}),
  };
}

/** 네이버 목록 항목 → 종목 정보 */
export function parseNaverStock(x: NaverItem, market: Market, exchange: Exchange): StockInfo | null {
  if (market === 'KR') {
    if (!x.itemCode || !x.stockName) return null;
    return { code: x.itemCode, market, exchange, nameKo: x.stockName, nameEn: '', currency: 'KRW' };
  }
  if (!x.symbolCode || !x.stockName) return null;
  return {
    code: usCode(x.symbolCode),
    market,
    exchange,
    nameKo: x.stockName,
    nameEn: x.stockNameEng ?? x.stockName,
    currency: currencyOf(market),
    ...(x.reutersCode ? { naverCode: x.reutersCode } : {}),
  };
}

function exchangeOf(x: NaverItem, market: Market): Exchange {
  const name = x.stockExchangeType?.name ?? '';
  return (market === 'KR' ? KR_EXCHANGES[name] : US_EXCHANGES[name]) ?? (market === 'KR' ? 'KOSPI' : 'NASDAQ');
}

/** "20261020" → 그날 UTC 0시 (초) */
function dateToTime(d: string): number {
  return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) / 1000;
}

/** 한국시간 "20261103090100" → epoch 초 */
function kstDateTimeToTime(d: string): number {
  return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(8, 10) - 9, +d.slice(10, 12)) / 1000;
}

export function parseNaverCandles(rows: NaverCandle[]): Candle[] {
  const out: Candle[] = [];
  for (const r of rows) {
    const close = r.closePrice ?? r.currentPrice;
    const time = r.localDateTime ? kstDateTimeToTime(r.localDateTime) : r.localDate ? dateToTime(r.localDate) : NaN;
    if (close === undefined || !Number.isFinite(time)) continue;
    out.push({
      time,
      open: r.openPrice ?? close,
      high: r.highPrice ?? close,
      low: r.lowPrice ?? close,
      close,
      volume: r.accumulatedTradingVolume ?? 0,
    });
  }
  return out.sort((a, b) => a.time - b.time);
}

const NAVER_PERIOD: Record<CandleInterval, { path: string; daysPerBar: number; minute?: number }> = {
  '1m': { path: 'minute', daysPerBar: 0, minute: 1 },
  '5m': { path: 'minute', daysPerBar: 0, minute: 5 },
  '15m': { path: 'minute', daysPerBar: 0, minute: 15 },
  '60m': { path: 'minute', daysPerBar: 0, minute: 60 },
  '1d': { path: 'day', daysPerBar: 1.6 },
  '1w': { path: 'week', daysPerBar: 7.1 },
  '1M': { path: 'month', daysPerBar: 31 },
};

/**
 * 네이버 증권 시세 (실시간).
 * 한국: 시세·차트 전부. 미국: 시세·일/주/월봉 (분봉은 안 줘서 실패 → 다음 소스가 처리)
 */
export class NaverSource implements QuoteSource {
  readonly name = 'naver';
  readonly delayMinutes = 0;

  constructor(
    private readonly market: Market,
    private readonly now: () => number = Date.now,
  ) {}

  async fetchQuotes(stocks: StockInfo[]): Promise<Quote[]> {
    const targets = stocks.flatMap((s) => {
      const id = this.market === 'KR' ? s.code : s.naverCode;
      return id ? [{ id, code: s.code }] : [];
    });
    if (targets.length === 0) return [];
    const kind = this.market === 'KR' ? 'domestic' : 'worldstock';
    const url = `https://polling.finance.naver.com/api/realtime/${kind}/stock/${targets.map((t) => encodeURIComponent(t.id)).join(',')}`;
    const res = await fetchJson<PollResponse>(url);
    if (!Array.isArray(res.datas)) throw new Error('네이버 시세 형식이 바뀌었어요');
    const codeById = new Map(targets.map((t) => [t.id, t.code]));
    return res.datas.flatMap((x) => {
      const id = this.market === 'KR' ? x.itemCode : x.reutersCode;
      const code = id ? codeById.get(id) : undefined;
      const q = code ? parseNaverQuote(x, code) : null;
      return q ? [q] : [];
    });
  }

  async fetchCandles(stock: StockInfo, interval: CandleInterval, limit: number): Promise<Candle[]> {
    const p = NAVER_PERIOD[interval];
    if (this.market === 'US' && p.minute) throw new UnsupportedError('네이버는 미국 분봉을 제공하지 않아요');
    const id = this.market === 'KR' ? stock.code : stock.naverCode;
    if (!id) throw new UnsupportedError('네이버 종목코드 없음');
    const end = this.now();
    // 분봉: 최근 영업일 며칠치, 그 외: 봉 개수만큼 거슬러 올라감
    const start = p.minute ? end - 6 * 86_400_000 : end - Math.ceil(limit * p.daysPerBar + 10) * 86_400_000;
    const kind = this.market === 'KR' ? 'domestic' : 'foreign';
    const url = `https://api.stock.naver.com/chart/${kind}/item/${encodeURIComponent(id)}/${p.path}?startDateTime=${kstStamp(start)}&endDateTime=${kstStamp(end)}`;
    const rows = await fetchJson<NaverCandle[]>(url, 12_000);
    if (!Array.isArray(rows)) throw new Error('네이버 차트 형식이 바뀌었어요');
    let candles = parseNaverCandles(rows);
    // 네이버 분봉엔 넥스트레이드(08:00~20:00) 거래도 섞여 있음 → 정규장(09:00~15:30)만
    if (p.minute && this.market === 'KR') candles = candles.filter((c) => isKrRegularMinute(c.time));
    if (p.minute && p.minute > 1) candles = aggregateCandles(candles, byMinutes(p.minute));
    if (candles.length === 0) throw new Error('네이버 차트 데이터 없음');
    return candles.slice(-limit);
  }

  /** 기간 지정 일봉 */
  async fetchHistory(stock: StockInfo, from: number, to: number): Promise<Candle[]> {
    const id = this.market === 'KR' ? stock.code : stock.naverCode;
    if (!id) throw new UnsupportedError('네이버 종목코드 없음');
    const kind = this.market === 'KR' ? 'domestic' : 'foreign';
    const url = `https://api.stock.naver.com/chart/${kind}/item/${encodeURIComponent(id)}/day?startDateTime=${kstStamp(from)}&endDateTime=${kstStamp(to)}`;
    const rows = await fetchJson<NaverCandle[]>(url, 15_000);
    if (!Array.isArray(rows)) throw new Error('네이버 차트 형식이 바뀌었어요');
    const candles = parseNaverCandles(rows);
    if (candles.length === 0) throw new Error('네이버 일봉 데이터 없음');
    return candles;
  }
}

/** 한국시간 09:00 ≤ t < 15:30 */
export function isKrRegularMinute(time: number): boolean {
  const minuteOfDay = Math.floor(((time + 9 * 3_600) % 86_400) / 60);
  return minuteOfDay >= 9 * 60 && minuteOfDay < 15 * 60 + 30;
}

/** 코스피·코스닥 지수 (실시간) */
export async function fetchNaverKrIndices(): Promise<IndexQuote[]> {
  const res = await fetchJson<PollResponse>('https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI,KOSDAQ');
  const names: Record<string, [string, string]> = { KOSPI: ['^KS11', '코스피'], KOSDAQ: ['^KQ11', '코스닥'] };
  return (res.datas ?? []).flatMap((x) => {
    const meta = x.itemCode ? names[x.itemCode] : undefined;
    const q = meta ? parseNaverQuote(x, meta[0]) : null;
    return q && meta ? [{ symbol: meta[0], name: meta[1], price: q.price, change: q.change, changeRate: q.changeRate }] : [];
  });
}

const RANK_PATH: Record<RankingType, string> = { gainers: 'up', losers: 'down', turnover: 'priceTop' };

/** 네이버 순위 (급상승·급하락·거래대금). 시장 하나 = 거래소 두 개 합침 */
export async function fetchNaverRankings(type: RankingType, market: Market, size = 20): Promise<RankingItem[]> {
  const path = RANK_PATH[type];
  const urls =
    market === 'KR'
      ? ['KOSPI', 'KOSDAQ'].map((ex) => `https://m.stock.naver.com/api/stocks/${path}/${ex}?page=1&pageSize=${size}`)
      : ['NASDAQ', 'NYSE'].map((ex) => `https://api.stock.naver.com/stock/exchange/${ex}/${path}?page=1&pageSize=${size}`);
  const lists = await Promise.all(urls.map((u) => fetchJson<ListResponse>(u)));
  return lists.flatMap((l) =>
    (l.stocks ?? []).flatMap((x) => {
      const stock = parseNaverStock(x, market, exchangeOf(x, market));
      const quote = stock ? parseNaverQuote(x, stock.code) : null;
      // 미국 급등락 순위는 $1 미만 동전주·워런트가 도배해서 제외
      if (market === 'US' && type !== 'turnover' && quote && quote.price < 1) return [];
      return stock && quote ? [{ stock, quote }] : [];
    }),
  );
}

/** 전체 종목 목록 (시가총액 순). 요청이 많아서 하루 한 번만 */
export async function fetchNaverDirectory(pause = 150): Promise<StockInfo[]> {
  const out: StockInfo[] = [];
  const sources: { market: Market; exchange: Exchange; url: (page: number) => string }[] = [
    { market: 'KR', exchange: 'KOSPI', url: (p) => `https://m.stock.naver.com/api/stocks/marketValue/KOSPI?page=${p}&pageSize=100` },
    { market: 'KR', exchange: 'KOSDAQ', url: (p) => `https://m.stock.naver.com/api/stocks/marketValue/KOSDAQ?page=${p}&pageSize=100` },
    ...(['NASDAQ', 'NYSE', 'AMEX'] as const).map((ex) => ({
      market: 'US' as const,
      exchange: ex,
      url: (p: number) => `https://api.stock.naver.com/stock/exchange/${ex}/marketValue?page=${p}&pageSize=100`,
    })),
  ];
  for (const src of sources) {
    for (let page = 1; page <= 100; page++) {
      const res = await fetchJson<ListResponse>(src.url(page), 15_000);
      const stocks = res.stocks ?? [];
      for (const x of stocks) {
        const s = parseNaverStock(x, src.market, src.exchange);
        if (s) out.push(s);
      }
      if (stocks.length < 100) break;
      await sleep(pause);
    }
  }
  return out;
}
