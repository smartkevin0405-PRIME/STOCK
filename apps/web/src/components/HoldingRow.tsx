import type { Position, StockInfo } from '@stock/shared';
import { Link } from 'react-router';
import { changeColor, formatMoney, formatRate, formatSigned } from '../lib/format';
import { useLiveQuote } from '../lib/live';
import { StockLogo } from './StockRow';

/** 보유 종목 한 줄: 평가금액 + 수익률 */
export function HoldingRow({ position, stock }: { position: Position; stock?: StockInfo }) {
  const quote = useLiveQuote(position.code);
  const price = quote?.price ?? position.avgPrice;
  const value = price * position.qty;
  const pnl = (price - position.avgPrice) * position.qty;
  const rate = position.avgPrice > 0 ? (price - position.avgPrice) / position.avgPrice : 0;
  const ccy = position.currency;
  return (
    <Link to={`/stock/${position.code}`} className="flex items-center gap-3 rounded-xl py-2.5 active:bg-soft">
      {stock ? <StockLogo stock={stock} /> : <div className="h-10 w-10 rounded-full bg-soft" />}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{stock?.nameKo ?? position.code}</p>
        <p className="text-[13px] text-sub">{position.qty.toLocaleString()}주</p>
      </div>
      <div className="text-right">
        <p className="font-semibold">{formatMoney(value, ccy)}</p>
        <p className={`text-[13px] font-medium ${changeColor(pnl)}`}>
          {formatSigned(pnl, ccy)} ({formatRate(rate)})
        </p>
      </div>
    </Link>
  );
}
