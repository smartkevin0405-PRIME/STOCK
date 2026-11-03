import { ColorType, LineSeries, createChart, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';

const MINE = '#3182f6';
const LINES = [
  { symbol: '^KS11', color: '#f04452' },
  { symbol: '^GSPC', color: '#8b5cf6' },
];

/** "2026-11-03" → 그날 UTC 0시 (초) */
const dayTime = (day: string) => (Date.parse(`${day}T00:00:00Z`) / 1000) as UTCTimestamp;

/** 내 자산 수익률 vs 코스피·S&P500 (첫날 = 0%) */
export function EquityChart({ equity, dark }: { equity: { day: string; totalKrw: number }[]; dark: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);

  // 'now'는 오늘 날짜로 (같은 날 기록이 있으면 그 자리를 지금 값으로)
  const today = new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);
  const points = new Map<string, number>();
  for (const e of equity) points.set(e.day === 'now' ? today : e.day, e.totalKrw);
  const days = [...points.keys()].sort();
  const first = days[0];
  const from = first ? Date.parse(`${first}T00:00:00Z`) - 7 * 86_400_000 : 0;
  const bench = useAsync(() => (first ? api.benchmarks(from) : Promise.resolve({ series: [] })), [first]);

  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, attributionLogo: false, fontFamily: 'inherit', textColor: dark ? '#8b8b96' : '#8b95a1' },
      grid: { vertLines: { visible: false }, horzLines: { color: dark ? '#22222a' : '#f2f4f6' } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      handleScroll: false,
      handleScale: false,
      localization: { locale: 'ko-KR', priceFormatter: (p: number) => `${p >= 0 ? '+' : ''}${p.toFixed(1)}%` },
    });
    chart.current = c;

    const base = first ? points.get(first)! : 0;
    const mine = c.addSeries(LineSeries, { color: MINE, lineWidth: 3, priceLineVisible: false, lastValueVisible: true });
    mine.setData(days.map((d) => ({ time: dayTime(d), value: (points.get(d)! / base - 1) * 100 })));

    for (const s of bench.data?.series ?? []) {
      const color = LINES.find((l) => l.symbol === s.symbol)?.color ?? '#8b95a1';
      // 내 첫날 이전 마지막 종가를 기준(0%)으로
      const start = first ? dayTime(first) : 0;
      const before = s.candles.filter((k) => k.time <= start);
      const baseClose = (before[before.length - 1] ?? s.candles[0])?.close;
      if (!baseClose) continue;
      const line = c.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
      line.setData(
        s.candles.filter((k) => k.time >= start).map((k) => ({ time: k.time as UTCTimestamp, value: (k.close / baseClose - 1) * 100 })),
      );
    }
    c.timeScale().fitContent();
    return () => {
      c.remove();
      chart.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(','), equity[equity.length - 1]?.totalKrw, bench.data, dark]);

  if (days.length < 2) {
    return <p className="py-6 text-center text-sm text-sub">하루가 지나면 자산 추이가 그려져요 (매일 오전 7시 기록)</p>;
  }

  return (
    <div>
      <div className="mb-1 flex gap-3 text-xs">
        <span style={{ color: MINE }}>● 내 자산</span>
        {(bench.data?.series ?? []).map((s) => (
          <span key={s.symbol} style={{ color: LINES.find((l) => l.symbol === s.symbol)?.color }}>
            ● {s.name}
          </span>
        ))}
      </div>
      <div ref={box} className="h-[200px] w-full" />
    </div>
  );
}
