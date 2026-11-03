import type { Candle, CandleInterval, Currency, Quote } from '@stock/shared';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatPrice } from '../lib/format';
import { useStored } from '../lib/storage';

const UP = '#f04452';
const DOWN = '#3182f6';
const MA = [
  { period: 5, color: '#ff9f1a' },
  { period: 20, color: '#00b386' },
  { period: 60, color: '#8b5cf6' },
  { period: 120, color: '#ec4899' },
] as const;

/** 볼린저밴드: 20일 이동평균 ± 표준편차 2배 (가운데 선은 20일선과 같아서 위·아래 선만) */
const BB = { period: 20, k: 2, color: '#94a3b8' } as const;
/** RSI: 14봉, 70 이상 과매수 / 30 이하 과매도 */
const RSI = { period: 14, upper: 70, lower: 30, color: '#d946ef' } as const;

const MINUTES: Partial<Record<CandleInterval, number>> = { '1m': 1, '5m': 5, '15m': 15, '60m': 60 };

/** 차트는 UTC로 그려서, 현지 시각으로 보이게 시차만큼 밀어줌 */
const TZ_SHIFT = -new Date().getTimezoneOffset() * 60;
const toTime = (t: number) => (t + TZ_SHIFT) as UTCTimestamp;
const shift = (c: Candle) => ({ ...c, time: toTime(c.time) });

type Point = { time: UTCTimestamp; value: number };

function sma(candles: Candle[], period: number): Point[] {
  const out: Point[] = [];
  let sum = 0;
  candles.forEach((c, i) => {
    sum += c.close;
    if (i >= period) sum -= candles[i - period]!.close;
    if (i >= period - 1) out.push({ time: toTime(c.time), value: sum / period });
  });
  return out;
}

function bollinger(candles: Candle[], period: number, k: number): { upper: Point[]; lower: Point[] } {
  const upper: Point[] = [];
  const lower: Point[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j]!.close;
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (candles[j]!.close - mean) ** 2;
    const sd = Math.sqrt(sq / period);
    const time = toTime(candles[i]!.time);
    upper.push({ time, value: mean + k * sd });
    lower.push({ time, value: mean - k * sd });
  }
  return { upper, lower };
}

/** 와일더(Wilder) 방식 RSI. 첫 값은 period+1번째 봉부터 */
function rsi(candles: Candle[], period: number): Point[] {
  const out: Point[] = [];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i]!.close - candles[i - 1]!.close;
    const gain = Math.max(diff, 0);
    const loss = Math.max(-diff, 0);
    if (i <= period) {
      avgGain += gain / period;
      avgLoss += loss / period;
      if (i < period) continue;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const value = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
    out.push({ time: toTime(candles[i]!.time), value });
  }
  return out;
}

interface Indicators {
  bb: boolean;
  rsi: boolean;
}

interface Props {
  code: string;
  currency: Currency;
  interval: CandleInterval;
  quote?: Quote;
  dark: boolean;
}

export function Chart({ code, currency, interval, quote, dark }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeries = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeries = useRef<ISeriesApi<'Line'>[]>([]);
  const bbSeries = useRef<ISeriesApi<'Line'>[]>([]);
  const rsiSeries = useRef<ISeriesApi<'Line'> | null>(null);
  const candles = useRef<Candle[]>([]);
  const [error, setError] = useState<string>();
  const [rsiNow, setRsiNow] = useState<number>();
  const [ind, setInd] = useStored<Indicators>('chart.indicators', { bb: false, rsi: false });

  /** 보조지표를 다시 계산해서 그림. live면 마지막 점만 갱신 */
  const drawIndicators = (live: boolean) => {
    const cs = candles.current;
    const put = (s: ISeriesApi<'Line'> | null | undefined, pts: Point[]) => {
      if (!s) return;
      if (!live) s.setData(pts);
      else if (pts.length) s.update(pts[pts.length - 1]!);
    };
    MA.forEach((m, i) => put(maSeries.current[i], sma(cs, m.period)));
    if (bbSeries.current.length) {
      const { upper, lower } = bollinger(cs, BB.period, BB.k);
      put(bbSeries.current[0], upper);
      put(bbSeries.current[1], lower);
    }
    if (rsiSeries.current) {
      const pts = rsi(cs, RSI.period);
      put(rsiSeries.current, pts);
      setRsiNow(pts[pts.length - 1]?.value);
    }
  };

  // 차트 생성
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, attributionLogo: false, fontFamily: 'inherit' },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 3 },
      crosshair: { mode: 0 },
      localization: { locale: 'ko-KR', priceFormatter: (p: number) => formatPrice(p, currency) },
    });
    candleSeries.current = c.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
      priceFormat: currency === 'KRW' ? { type: 'price', precision: 0, minMove: 1 } : { type: 'price', precision: 2, minMove: 0.0001 },
    });
    volumeSeries.current = c.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candleSeries.current.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    maSeries.current = MA.map((m) =>
      c.addSeries(LineSeries, { color: m.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
    );
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, [currency]);

  // 볼린저밴드 켜기/끄기 (캔들 위에 겹쳐 그림)
  useEffect(() => {
    const c = chart.current;
    if (!c || !ind.bb) return;
    const line = { color: BB.color, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false } as const;
    bbSeries.current = [c.addSeries(LineSeries, line), c.addSeries(LineSeries, line)];
    drawIndicators(false);
    return () => {
      if (chart.current === c) bbSeries.current.forEach((s) => c.removeSeries(s));
      bbSeries.current = [];
    };
  }, [ind.bb, currency]);

  // RSI 켜기/끄기 (아래쪽 별도 패널. 마지막 시리즈를 지우면 패널도 같이 사라짐)
  useEffect(() => {
    const c = chart.current;
    if (!c || !ind.rsi) return;
    const s = c.addSeries(
      LineSeries,
      {
        color: RSI.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: { type: 'custom', formatter: (p: number) => p.toFixed(0), minMove: 0.01 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      },
      1,
    );
    for (const price of [RSI.upper, RSI.lower]) {
      s.createPriceLine({ price, color: '#8b95a1', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    }
    c.panes()[0]?.setStretchFactor(3);
    c.panes()[1]?.setStretchFactor(1);
    rsiSeries.current = s;
    drawIndicators(false);
    return () => {
      if (chart.current === c) c.removeSeries(s);
      rsiSeries.current = null;
      setRsiNow(undefined);
    };
  }, [ind.rsi, currency]);

  // 테마
  useEffect(() => {
    chart.current?.applyOptions({
      layout: { textColor: dark ? '#8b8b96' : '#8b95a1', panes: { separatorColor: dark ? '#2c2c35' : '#e5e8eb' } },
      grid: { vertLines: { color: dark ? '#22222a' : '#f2f4f6' }, horzLines: { color: dark ? '#22222a' : '#f2f4f6' } },
      timeScale: { timeVisible: interval in MINUTES, secondsVisible: false },
    });
  }, [dark, interval, currency]);

  // 데이터
  useEffect(() => {
    let alive = true;
    setError(undefined);
    api.candles(code, interval, 400).then(
      ({ candles: data }) => {
        if (!alive || !candleSeries.current) return;
        candles.current = data;
        candleSeries.current.setData(data.map(shift));
        volumeSeries.current?.setData(
          data.map((c) => ({ time: toTime(c.time), value: c.volume, color: c.close >= c.open ? `${UP}55` : `${DOWN}55` })),
        );
        drawIndicators(false);
        chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 90), to: data.length + 3 });
      },
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [code, interval, currency]);

  // 실시간 반영: 마지막 봉 갱신 (분봉은 시간이 넘어가면 새 봉) + 보조지표 마지막 값
  useEffect(() => {
    const cs = candles.current;
    const prev = cs[cs.length - 1];
    if (!quote || !prev || !candleSeries.current) return;
    const minutes = MINUTES[interval];
    let next: Candle;
    let isNew = false;
    if (minutes) {
      const bucket = Math.floor(quote.timestamp / 1000 / (minutes * 60)) * minutes * 60;
      if (bucket < prev.time) return;
      isNew = bucket > prev.time;
      next = isNew
        ? { time: bucket, open: prev.close, high: Math.max(prev.close, quote.price), low: Math.min(prev.close, quote.price), close: quote.price, volume: 0 }
        : { ...prev, high: Math.max(prev.high, quote.price), low: Math.min(prev.low, quote.price), close: quote.price };
    } else {
      next = { ...prev, high: Math.max(prev.high, quote.price), low: Math.min(prev.low, quote.price), close: quote.price };
    }
    candles.current = isNew ? [...cs, next] : [...cs.slice(0, -1), next];
    candleSeries.current.update(shift(next));
    drawIndicators(true);
  }, [quote, interval]);

  const chip = (on: boolean) => `pointer-events-auto rounded px-1.5 py-0.5 font-semibold ${on ? 'bg-soft text-ink' : 'text-sub'}`;

  return (
    <div className={`relative w-full ${ind.rsi ? 'h-[370px]' : 'h-[280px]'}`}>
      <div ref={box} className="absolute inset-0" />
      {error && <p className="absolute inset-0 flex items-center justify-center text-sm text-sub">{error}</p>}
      <div className="pointer-events-none absolute left-1 top-0 z-10 flex items-center gap-2 text-[11px]">
        {MA.map((m) => (
          <span key={m.period} style={{ color: m.color }}>
            {m.period}
          </span>
        ))}
        <button type="button" className={chip(ind.bb)} onClick={() => setInd({ ...ind, bb: !ind.bb })} aria-pressed={ind.bb}>
          {ind.bb ? <span style={{ color: BB.color }}>●</span> : null} BB
        </button>
        <button type="button" className={chip(ind.rsi)} onClick={() => setInd({ ...ind, rsi: !ind.rsi })} aria-pressed={ind.rsi}>
          {ind.rsi ? <span style={{ color: RSI.color }}>●</span> : null} RSI{ind.rsi && rsiNow !== undefined ? ` ${rsiNow.toFixed(0)}` : ''}
        </button>
      </div>
    </div>
  );
}
