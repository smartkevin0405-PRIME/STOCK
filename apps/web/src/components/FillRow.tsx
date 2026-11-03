import type { Fill, StockInfo } from '@stock/shared';
import { changeColor, formatDateTime, formatMoney, formatPrice, formatSigned } from '../lib/format';

export function FillRow({ fill, stock }: { fill: Fill; stock?: StockInfo }) {
  const ccy = fill.currency;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate font-semibold">{stock?.nameKo ?? fill.code}</p>
        <p className="text-[13px] text-sub">
          <span className={fill.side === 'buy' ? 'text-up' : 'text-down'}>{fill.side === 'buy' ? '구매' : '판매'}</span> ·{' '}
          {fill.qty.toLocaleString()}주 × {formatPrice(fill.price, ccy)}
        </p>
        <p className="text-xs text-sub">
          {formatDateTime(fill.executedAt)} · 수수료 {formatMoney(fill.commission, ccy)}
          {fill.tax ? ` · 세금 ${formatMoney(fill.tax, ccy)}` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold">{formatMoney(fill.amount, ccy)}</p>
        {fill.side === 'sell' && fill.realizedPnl !== undefined && (
          <p className={`text-[13px] font-medium ${changeColor(fill.realizedPnl)}`}>
            {formatSigned(fill.realizedPnl, ccy)}
            {ccy === 'KRW' ? '원' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
