import type { Market, MarketStatus } from '@stock/shared';
import { HOLIDAYS } from './holidays';

interface SessionDef {
  timeZone: string;
  open: [number, number];
  close: [number, number];
}

// 정규장만 (시간외·프리/애프터마켓은 MVP 이후)
const SESSIONS: Record<Market, SessionDef> = {
  KR: { timeZone: 'Asia/Seoul', open: [9, 0], close: [15, 30] },
  US: { timeZone: 'America/New_York', open: [9, 30], close: [16, 0] },
};

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(ts: number, timeZone: string): ZonedParts {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  const get = (type: string) => Number(f.formatToParts(new Date(ts)).find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** 해당 시점의 UTC 대비 시차 (ms). 서머타임 자동 반영 */
function zoneOffset(ts: number, timeZone: string): number {
  const minuteTs = Math.floor(ts / 60_000) * 60_000;
  const p = zonedParts(minuteTs, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - minuteTs;
}

/** 현지 날짜·시각 → epoch ms */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ts = guess - zoneOffset(guess, timeZone);
  const corrected = guess - zoneOffset(ts, timeZone);
  if (corrected !== ts) ts = corrected;
  return ts;
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isTradingDay(market: Market, year: number, month: number, day: number): boolean {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !HOLIDAYS[market].has(ymd(year, month, day));
}

export function getMarketStatus(market: Market, now: number = Date.now()): MarketStatus {
  const s = SESSIONS[market];
  const today = zonedParts(now, s.timeZone);
  const openAt = (y: number, m: number, d: number) => zonedToUtc(y, m, d, s.open[0], s.open[1], s.timeZone);
  const closeAt = (y: number, m: number, d: number) => zonedToUtc(y, m, d, s.close[0], s.close[1], s.timeZone);

  const isToday = isTradingDay(market, today.year, today.month, today.day);
  const todayOpen = openAt(today.year, today.month, today.day);
  const todayClose = closeAt(today.year, today.month, today.day);

  const open = isToday && now >= todayOpen && now < todayClose;

  let nextOpen: number | undefined;
  if (isToday && now < todayOpen) nextOpen = todayOpen;
  for (let i = 1; nextOpen === undefined && i <= 15; i++) {
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    if (isTradingDay(market, y, m, dd)) nextOpen = openAt(y, m, dd);
  }

  return {
    market,
    state: open ? 'open' : 'closed',
    nextOpen: nextOpen ?? todayOpen,
    ...(open ? { closeAt: todayClose } : {}),
  };
}

export function isMarketOpen(market: Market, now: number = Date.now()): boolean {
  return getMarketStatus(market, now).state === 'open';
}
