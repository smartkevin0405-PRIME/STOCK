import type { Currency } from '@stock/shared';

const krw = new Intl.NumberFormat('ko-KR');
const compact = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });

/** 가격 (원: 72,900 / 달러: $227.08, $1 미만은 소수 4자리) */
export function formatPrice(price: number, currency: Currency): string {
  if (currency === 'KRW') return krw.format(Math.round(price));
  const digits = Math.abs(price) < 1 ? 4 : 2;
  return '$' + price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 가격 + 단위 (원: 72,900원 / 달러: $227.08) */
export function formatMoney(amount: number, currency: Currency): string {
  if (currency === 'KRW') return `${krw.format(Math.round(amount))}원`;
  const sign = amount < 0 ? '-' : '';
  return sign + '$' + Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 입력 중인 숫자에 쉼표 넣기 (소수점 아래는 입력한 그대로) */
export function formatNumberInput(text: string): string {
  const [int = '', frac] = text.replace(/[^0-9.]/g, '').split('.');
  const withCommas = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? withCommas : `${withCommas || '0'}.${frac}`;
}

export function parseNumberInput(text: string): number {
  return Number(text.replace(/,/g, '')) || 0;
}

export function formatSigned(change: number, currency: Currency): string {
  const sign = change > 0 ? '+' : change < 0 ? '-' : '';
  return sign + formatPrice(Math.abs(change), currency);
}

export function formatRate(rate: number): string {
  const pct = rate * 100;
  const sign = pct > 0.0049 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

export function formatCompact(n: number): string {
  return compact.format(n);
}

export function formatIndex(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 상승 빨강 / 하락 파랑 / 보합 회색 */
export function changeColor(change: number): string {
  if (change > 0) return 'text-up';
  if (change < 0) return 'text-down';
  return 'text-sub';
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
