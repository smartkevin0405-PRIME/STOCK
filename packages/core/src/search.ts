import type { StockInfo } from '@stock/shared';

const CHOSUNG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/** "삼성전자" → "ㅅㅅㅈㅈ" (한글 외 문자는 그대로) */
export function toChosung(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) out += CHOSUNG[Math.floor((c - 0xac00) / 588)];
    else out += ch;
  }
  return out;
}

function isChosungQuery(q: string): boolean {
  return [...q].some((ch) => ch >= 'ㄱ' && ch <= 'ㅎ');
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function score(stock: StockInfo, q: string): number {
  const code = stock.code.toLowerCase();
  const ko = normalize(stock.nameKo);
  const en = normalize(stock.nameEn);
  const aliases = (stock.aliases ?? []).map(normalize);

  if (code === q) return 100;
  if (ko === q || aliases.includes(q)) return 95;
  if (code.startsWith(q)) return 90;
  if (ko.startsWith(q)) return 80;
  if (aliases.some((a) => a.startsWith(q))) return 75;
  if (en.startsWith(q)) return 70;
  if (isChosungQuery(q)) {
    const cho = normalize(toChosung(stock.nameKo));
    if (cho.startsWith(q)) return 65;
    if (cho.includes(q)) return 50;
    if (aliases.some((a) => normalize(toChosung(a)).startsWith(q))) return 45;
  }
  if (ko.includes(q)) return 60;
  if (aliases.some((a) => a.includes(q))) return 55;
  if (en.includes(q)) return 40;
  return 0;
}

/** 종목코드·한글명·영문명·별칭·초성 검색 */
export function searchStocks(stocks: readonly StockInfo[], query: string, limit = 20): StockInfo[] {
  const q = normalize(query);
  if (!q) return [];
  return stocks
    .map((s) => ({ s, sc: score(s, q) }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc || a.s.nameKo.localeCompare(b.s.nameKo, 'ko'))
    .slice(0, limit)
    .map((x) => x.s);
}
