// 야후는 브라우저 전체 UA를 보내면 오히려 429로 막아서 짧은 UA 사용
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json',
};

/** JSON GET. 시간 초과·HTTP 오류는 예외 */
export async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${new URL(url).host}`);
  return (await res.json()) as T;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "1,234.5" / 1234.5 / "-7,250" → 숫자. 못 읽으면 undefined */
export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const n = Number(v.replace(/,/g, '').trim());
  return v.trim() !== '' && Number.isFinite(n) ? n : undefined;
}

/** 한국시간 "YYYYMMDDHHmm" (네이버 차트 요청용) */
export function kstStamp(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
