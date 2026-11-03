import type { ReplayTrade } from '@stock/core';
import type { Candle, Currency } from '@stock/shared';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { formatPrice } from '../lib/format';

const UP = '#f04452';
const DOWN = '#3182f6';
const MA = [
  { period: 5, color: '#ff9f1a' },
  { period: 20, color: '#00b386' },
  { period: 60, color: '#8b5cf6' },
] as const;

// 일봉 time은 그날 UTC 자정이라 시차 보정 없이 그대로 그림
const t = (time: number) => time as UTCTimestamp;

function sma(candles: Candle[], period: number) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;
  candles.forEach((c, i) => {
    sum += c.close;
    if (i >= period) sum -= candles[i - period]!.close;
    if (i >= period - 1) out.push({ time: t(c.time), value: sum / period });
  });
  return out;
}

interface Props {
  /** 지금 날짜까지 보이는 봉만 */
  candles: Candle[];
  currency: Currency;
  dark: boolean;
  /** 이 종목 거래 (차트에 ▲▼ 표시) */
  trades: ReplayTrade[];
  /** 바뀌면 처음부터 다시 그림 (종목 바꿈·다시 시작) */
  resetKey: string;
}

/** 리플레이 차트: 하루씩 봉이 늘어남 */
export function ReplayChart({ candles, currency, dark, trades, resetKey }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeries = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeries = useRef<ISeriesApi<'Line'>[]>([]);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const drawn = useRef<{ key: string; candles: Candle[] }>({ key: '', candles: [] });

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, attributionLogo: false, fontFamily: 'inherit' },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 3 },
      crosshair: { mode: 0 },
      localization: {
        locale: 'ko-KR',
        priceFormatter: (p: number) => formatPrice(p, currency),
        timeFormatter: (time: Time) => new Date((time as number) * 1000).toLocaleDateString('ko-KR', { timeZone: 'UTC' }),
      },
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
    markers.current = createSeriesMarkers(candleSeries.current, []);
    chart.current = c;
    drawn.current = { key: '', candles: [] };
    return () => {
      c.remove();
      chart.current = null;
    };
  }, [currency]);

  useEffect(() => {
    chart.current?.applyOptions({
      layout: { textColor: dark ? '#8b8b96' : '#8b95a1' },
      grid: { vertLines: { color: dark ? '#22222a' : '#f2f4f6' }, horzLines: { color: dark ? '#22222a' : '#f2f4f6' } },
    });
  }, [dark, currency]);

  // 봉 그리기: 하루 넘어가면 마지막 봉만 추가, 그 외엔 전부 다시
  useEffect(() => {
    const cs = candleSeries.current;
    const vs = volumeSeries.current;
    if (!cs || !vs) return;
    const prev = drawn.current;
    const vol = (c: Candle) => ({ time: t(c.time), value: c.volume, color: c.close >= c.open ? `${UP}55` : `${DOWN}55` });
    const last = candles[candles.length - 1];
    const appended = prev.key === resetKey && candles.length === prev.candles.length + 1 && candles[prev.candles.length - 1] === prev.candles[prev.candles.length - 1];
    if (appended && last) {
      cs.update({ ...last, time: t(last.time) });
      vs.update(vol(last));
    } else {
      cs.setData(candles.map((c) => ({ ...c, time: t(c.time) })));
      vs.setData(candles.map(vol));
      chart.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 80), to: candles.length + 3 });
    }
    MA.forEach((m, i) => maSeries.current[i]?.setData(sma(candles, m.period)));
    drawn.current = { key: resetKey, candles };
  }, [candles, resetKey, currency]);

  // 거래 표시
  useEffect(() => {
    markers.current?.setMarkers(
      trades.map((tr) =>
        tr.side === 'buy'
          ? { time: t(tr.time), position: 'belowBar' as const, color: UP, shape: 'arrowUp' as const, text: `구매 ${tr.qty}` }
          : { time: t(tr.time), position: 'aboveBar' as const, color: DOWN, shape: 'arrowDown' as const, text: `판매 ${tr.qty}` },
      ),
    );
  }, [trades, resetKey, currency]);

  return (
    <div className="relative h-[260px] w-full">
      <div ref={box} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-1 top-0 z-10 flex gap-2 text-[11px]">
        {MA.map((m) => (
          <span key={m.period} style={{ color: m.color }}>
            {m.period}
          </span>
        ))}
      </div>
    </div>
  );
}
