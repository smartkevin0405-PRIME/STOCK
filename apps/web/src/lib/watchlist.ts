import { useStored } from './storage';

// M3에서 서버 저장 + 그룹 기능으로 확장
const DEFAULT = ['005930', '000660', 'AAPL', 'NVDA', 'TSLA'];

export function useWatchlist() {
  const [codes, setCodes] = useStored<string[]>('watchlist', DEFAULT);
  const has = (code: string) => codes.includes(code);
  const toggle = (code: string) => setCodes(has(code) ? codes.filter((c) => c !== code) : [...codes, code]);
  return { codes, has, toggle };
}
