import { useState } from 'react';
import { changeColor, formatSigned } from '../lib/format';

const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

/** 1234567 → "+123.5만" / 3500 → "+3,500" (칸이 좁아서 짧게) */
function short(v: number): string {
  if (Math.abs(v) >= 10_000) return `${v > 0 ? '+' : ''}${(Math.round(v / 1000) / 10).toLocaleString()}만`;
  return formatSigned(v, 'KRW');
}

/** 월별 수익 달력 (하루 = 한국시간 오전 7시 기준) */
export function ProfitCalendar({ days }: { days: { day: string; pnlKrw: number }[] }) {
  const byDay = new Map(days.map((d) => [d.day, d.pnlKrw]));
  const latest = days[days.length - 1]?.day ?? new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState(latest.slice(0, 7)); // "2026-11"

  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // 월요일 시작
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= count; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`);

  const monthTotal = [...byDay].filter(([d]) => d.startsWith(month)).reduce((s, [, v]) => s + v, 0);
  const move = (dir: -1 | 1) => {
    const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => move(-1)} className="px-2 text-lg text-sub" aria-label="이전 달">
          ‹
        </button>
        <div className="text-center">
          <p className="font-semibold">
            {y}년 {m}월
          </p>
          <p className={`text-sm font-medium ${changeColor(monthTotal)}`}>{formatSigned(Math.round(monthTotal), 'KRW')}원</p>
        </div>
        <button onClick={() => move(1)} className="px-2 text-lg text-sub" aria-label="다음 달">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEK.map((w) => (
          <p key={w} className="text-[11px] text-sub">
            {w}
          </p>
        ))}
        {cells.map((day, i) => {
          const v = day ? byDay.get(day) : undefined;
          const tone = v === undefined || v === 0 ? 'bg-soft' : v > 0 ? 'bg-up/15' : 'bg-down/15';
          return (
            <div key={day ?? `x${i}`} className={`flex h-12 flex-col items-center justify-center rounded-lg ${day ? tone : ''}`}>
              {day && <span className="text-[11px] text-sub">{Number(day.slice(8))}</span>}
              {v !== undefined && v !== 0 && <span className={`text-[10px] font-semibold ${changeColor(v)}`}>{short(v)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
