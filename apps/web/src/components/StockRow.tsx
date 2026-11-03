import type { Quote, StockInfo } from '@stock/shared';
import { Link } from 'react-router';
import { changeColor, formatPrice, formatRate } from '../lib/format';
import { useLiveQuote } from '../lib/live';

const COLORS = ['#3182f6', '#f04452', '#00b386', '#ff9f1a', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

export function StockLogo({ stock, size = 40 }: { stock: StockInfo; size?: number }) {
  let h = 0;
  for (const ch of stock.code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const label = stock.market === 'US' ? stock.code.slice(0, 2) : stock.nameKo.replace(/^[A-Z]+/, '').slice(0, 1) || stock.nameKo.slice(0, 1);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: COLORS[h % COLORS.length], fontSize: size * 0.36 }}
    >
      {label}
    </div>
  );
}

export function StockRow({ stock, quote, rank }: { stock: StockInfo; quote?: Quote | null; rank?: number }) {
  const q = useLiveQuote(stock.code, quote);
  return (
    <Link to={`/stock/${stock.code}`} className="flex items-center gap-3 rounded-xl py-2.5 active:bg-soft">
      {rank !== undefined && <span className="w-5 text-center text-sm font-semibold text-brand">{rank}</span>}
      <StockLogo stock={stock} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{stock.nameKo}</p>
        <p className="text-[13px] text-sub">
          {stock.code} · {stock.exchange}
        </p>
      </div>
      {q && (
        <div className="text-right">
          <p className="font-semibold">{formatPrice(q.price, stock.currency)}</p>
          <p className={`text-[13px] font-medium ${changeColor(q.change)}`}>{formatRate(q.changeRate)}</p>
        </div>
      )}
    </Link>
  );
}
