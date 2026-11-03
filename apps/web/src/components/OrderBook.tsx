import type { Currency, OrderBook as Book, OrderBookLevel } from '@stock/shared';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { changeColor, formatPrice, formatRate } from '../lib/format';

const POLL_MS = 3_000;

/** 10단계 호가창. 호가를 주는 시세 소스(한투)가 없으면 아무것도 안 그림 */
export function OrderBook({ code, currency, prevClose, price }: { code: string; currency: Currency; prevClose: number; price: number }) {
  const [book, setBook] = useState<Book | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setBook(null);
    const load = async () => {
      try {
        const res = await apiFetch(`/api/orderbook/${encodeURIComponent(code)}`);
        if (!alive) return;
        // 404: 호가 소스 없음 → 더 안 부름
        if (res.status === 404) return setBook(null);
        if (res.ok) setBook(((await res.json()) as { book: Book }).book);
      } catch {
        // 잠깐 실패하면 마지막 호가 유지
      }
      if (alive) timer = setTimeout(load, document.hidden ? POLL_MS * 5 : POLL_MS);
    };
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [code]);

  if (!book || (book.asks.length === 0 && book.bids.length === 0)) return null;

  const max = Math.max(1, ...book.asks.map((l) => l.qty), ...book.bids.map((l) => l.qty));
  const asks = [...book.asks].reverse(); // 비싼 것이 위로

  return (
    <section className="rounded-2xl bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[17px] font-bold">호가</h2>
        <span className="text-xs text-sub">10단계 · 실시간</span>
      </div>
      <div className="overflow-hidden rounded-xl text-[13px]">
        {asks.map((l) => (
          <Row key={`a${l.price}`} level={l} side="ask" max={max} currency={currency} prevClose={prevClose} current={l.price === price} />
        ))}
        {book.bids.map((l) => (
          <Row key={`b${l.price}`} level={l} side="bid" max={max} currency={currency} prevClose={prevClose} current={l.price === price} />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs text-sub">
        <span className="text-right">{book.totalAskQty.toLocaleString()}</span>
        <span className="px-2">총 잔량</span>
        <span>{book.totalBidQty.toLocaleString()}</span>
      </div>
    </section>
  );
}

function Row({
  level,
  side,
  max,
  currency,
  prevClose,
  current,
}: {
  level: OrderBookLevel;
  side: 'ask' | 'bid';
  max: number;
  currency: Currency;
  prevClose: number;
  current: boolean;
}) {
  const rate = prevClose > 0 ? level.price / prevClose - 1 : 0;
  const width = `${Math.max(2, (level.qty / max) * 100)}%`;
  const qty = level.qty.toLocaleString();
  return (
    <div className={`grid grid-cols-[1fr_auto_1fr] items-stretch ${side === 'ask' ? 'bg-down/5' : 'bg-up/5'}`}>
      {/* 매도 잔량: 왼쪽, 막대는 오른쪽 정렬 */}
      <div className="relative flex items-center justify-end px-2 py-1.5">
        {side === 'ask' && (
          <>
            <span className="absolute inset-y-1 right-0 rounded-l bg-down/15" style={{ width }} />
            <span className="relative">{qty}</span>
          </>
        )}
      </div>
      <div className={`flex min-w-[112px] flex-col items-center justify-center px-2 py-1 ${current ? 'rounded-md ring-1 ring-ink' : ''}`}>
        <span className={`font-semibold ${changeColor(rate)}`}>{formatPrice(level.price, currency)}</span>
        <span className={`text-[11px] ${changeColor(rate)}`}>{formatRate(rate)}</span>
      </div>
      {/* 매수 잔량: 오른쪽, 막대는 왼쪽 정렬 */}
      <div className="relative flex items-center px-2 py-1.5">
        {side === 'bid' && (
          <>
            <span className="absolute inset-y-1 left-0 rounded-r bg-up/15" style={{ width }} />
            <span className="relative">{qty}</span>
          </>
        )}
      </div>
    </div>
  );
}
