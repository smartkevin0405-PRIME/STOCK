import type { AlertKind, PriceAlert, StockInfo } from '@stock/shared';
import { formatMoney } from './format';

export const ALERT_KINDS: { value: AlertKind; label: string }[] = [
  { value: 'above', label: '이상' },
  { value: 'below', label: '이하' },
  { value: 'rise', label: '상승률' },
  { value: 'fall', label: '하락률' },
];

/** "75,000원 이상" / "전일 대비 +5% 이상" */
export function describeAlert(a: Pick<PriceAlert, 'kind' | 'value'>, stock?: Pick<StockInfo, 'currency'>): string {
  const money = (v: number) => formatMoney(v, stock?.currency ?? 'KRW');
  switch (a.kind) {
    case 'above':
      return `${money(a.value)} 이상`;
    case 'below':
      return `${money(a.value)} 이하`;
    case 'rise':
      return `전일 대비 +${a.value}% 이상`;
    case 'fall':
      return `전일 대비 -${a.value}% 이하`;
  }
}
