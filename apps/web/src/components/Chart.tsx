import type { Candle, CandleInterval, Currency, Quote } from '@stock/shared';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatPrice } from '../lib/format';

const UP = '#f04452';
const DOWN = '#3182f6';
const MA = [
  { period: 5, color: '#ff9f1a' },
  { period: 20, color: '#00b386' },
  { period: 60, color: '#8b5cf6' },
] as const;

const MINUTES: Partial<Record<CandleInterval, number>> = { '1m': 1, '5m': 5, '15m': 15, '60m': 60 };

/** 차트는 UTC로 그려서, 현지 시각으로 보이게 시차만큼 밀어줌 */
const TZ_SHIFT = -new Date().getTimezoneOffset() * 60;
const shift = (c: Candle) => ({ ...c, time: (c.time + TZ_SHIFT) as UTCTimestamp });

function sma(candles: Candle[], period: number) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;
  candles.forEach((c, i) => {
    sum += c.close;
    if (i >= period) sum -= candles[i - period]!.close;
    if (i >= period - 1) out.push({ time: (c.time + TZ_SHIFT) as UTCTimestamp, value: sum / period });
  });
  return out;
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
  const last = useRef<Candle | null>(null);
  const [error, setError] = useState<string>();

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

  // 테마
  useEffect(() => {
    chart.current?.applyOptions({
      layout: { textColor: dark ? '#8b8b96' : '#8b95a1' },
      grid: { vertLines: { color: dark ? '#22222a' : '#f2f4f6' }, horzLines: { color: dark ? '#22222a' : '#f2f4f6' } },
      timeScale: { timeVisible: interval in MINUTES, secondsVisible: false },
    });
  }, [dark, interval, currency]);

  // 데이터
  useEffect(() => {
    let alive = true;
    setError(undefined);
    api.candles(code, interval, 400).then(
      ({ candles }) => {
        if (!alive || !candleSeries.current) return;
        candleSeries.current.setData(candles.map(shift));
        volumeSeries.current?.setData(
          candles.map((c) => ({ time: (c.time + TZ_SHIFT) as UTCTimestamp, value: c.volume, color: c.close >= c.open ? `${UP}55` : `${DOWN}55` })),
        );
        MA.forEach((m, i) => maSeries.current[i]?.setData(sma(candles, m.period)));
        last.current = candles[candles.length - 1] ?? null;
        chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 90), to: candles.length + 3 });
      },
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [code, interval, currency]);

  // 실시간 반영: 마지막 봉 갱신 (분봉은 시간이 넘어가면 새 봉)
  useEffect(() => {
    const prev = last.current;
    if (!quote || !prev || !candleSeries.current) return;
    const minutes = MINUTES[interval];
    let next: Candle;
    if (minutes) {
      const bucket = Math.floor(quote.timestamp / 1000 / (minutes * 60)) * minutes * 60;
      if (bucket < prev.time) return;
      next =
        bucket > prev.time
          ? { time: bucket, open: prev.close, high: Math.max(prev.close, quote.price), low: Math.min(prev.close, quote.price), close: quote.price, volume: 0 }
          : { ...prev, high: Math.max(prev.high, quote.price), low: Math.min(prev.low, quote.price), close: quote.price };
    } else {
      next = { ...prev, high: Math.max(prev.high, quote.price), low: Math.min(prev.low, quote.price), close: quote.price };
    }
    last.current = next;
    candleSeries.current.update(shift(next));
  }, [quote, interval]);

  return (
    <div className="relative h-[280px] w-full">
      <div ref={box} className="absolute inset-0" />
      {error && <p className="absolute inset-0 flex items-center justify-center text-sm text-sub">{error}</p>}
      <div className="pointer-events-none absolute left-1 top-0 flex gap-2 text-[11px]">
        {MA.map((m) => (
          <span key={m.period} style={{ color: m.color }}>
            {m.period}
          </span>
        ))}
      </div>
    </div>
  );
}
