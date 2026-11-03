import type { Quote, StockInfo } from '@stock/shared';
import { useAccount } from '../lib/account';
import { api } from '../lib/api';
import { changeColor, formatMoney, formatPrice, formatRate, formatSigned } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { OrderRow } from './OrderRow';

/** 종목 화면의 '내 주식': 보유 현황 + 이 종목 미체결 주문 */
export function MyStock({ stock, quote }: { stock: StockInfo; quote: Quote }) {
  const acct = useAccount();
  const orders = useAsync(() => api.orders('open'), [acct]);
  const position = acct?.positions.find((p) => p.code === stock.code);
  const open = orders.data?.orders.filter((o) => o.code === stock.code) ?? [];
  const ccy = stock.currency;

  return (
    <section className="rounded-2xl bg-card p-5">
      <h2 className="mb-3 text-[17px] font-bold">내 주식</h2>
      {position ? (
        (() => {
          const value = quote.price * position.qty;
          const pnl = (quote.price - position.avgPrice) * position.qty;
          const rate = (quote.price - position.avgPrice) / position.avgPrice;
          return (
            <>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm text-sub">{position.qty.toLocaleString()}주 보유</p>
                  <p className="text-xl font-bold">{formatMoney(value, ccy)}</p>
                </div>
                <p className={`text-right font-semibold ${changeColor(pnl)}`}>
                  {formatSigned(pnl, ccy)}
                  {ccy === 'KRW' ? '원' : ''}
                  <br />
                  <span className="text-sm">{formatRate(rate)}</span>
                </p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-sub">평균단가</dt>
                  <dd className="font-medium">{formatPrice(position.avgPrice, ccy)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-sub">판매 가능</dt>
                  <dd className="font-medium">{(acct?.sellable[stock.code] ?? 0).toLocaleString()}주</dd>
                </div>
              </dl>
            </>
          );
        })()
      ) : (
        <p className="text-sm text-sub">보유하고 있지 않아요</p>
      )}
      {open.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold">미체결 주문 {open.length}건</p>
          {open.map((o) => (
            <OrderRow key={`${o.id}:${o.updatedAt}`} order={o} stock={stock} />
          ))}
        </div>
      )}
    </section>
  );
}
