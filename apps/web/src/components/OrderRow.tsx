import { roundToTick, tickSize } from '@stock/core';
import type { Order, StockInfo } from '@stock/shared';
import { currencyOf } from '@stock/shared';
import { useState } from 'react';
import { account } from '../lib/account';
import { api } from '../lib/api';
import { formatDateTime, formatNumberInput, formatPrice, parseNumberInput } from '../lib/format';
import { toast } from '../lib/toast';

const STATUS: Record<Order['status'], string> = {
  pending: '대기',
  reserved: '예약',
  filled: '체결',
  cancelled: '취소',
  rejected: '거부',
};

/** 주문 한 줄. 미체결이면 정정·취소 가능 */
export function OrderRow({ order, stock, onChanged }: { order: Order; stock?: StockInfo; onChanged?: () => void }) {
  const ccy = currencyOf(order.market);
  const open = order.status === 'pending' || order.status === 'reserved';
  const [editing, setEditing] = useState(false);
  const [priceText, setPriceText] = useState(formatNumberInput(String(order.limitPrice ?? '')));
  const [qtyText, setQtyText] = useState(String(order.qty));
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      setEditing(false);
      await account.refresh();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const price = parseNumberInput(priceText);
  const step = (dir: 1 | -1) => {
    const t = dir > 0 ? tickSize(order.market, price) : tickSize(order.market, price - 1e-9);
    setPriceText(formatNumberInput(String(roundToTick(order.market, price + dir * t, 'nearest'))));
  };

  return (
    <div className="border-b border-line py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{stock?.nameKo ?? order.code}</p>
          <p className="text-[13px] text-sub">
            <span className={order.side === 'buy' ? 'text-up' : 'text-down'}>{order.side === 'buy' ? '구매' : '판매'}</span> ·{' '}
            {order.type === 'limit' ? `지정가 ${formatPrice(order.limitPrice ?? 0, ccy)}` : '시장가'} · {order.qty.toLocaleString()}주
          </p>
          <p className="text-xs text-sub">
            {formatDateTime(order.createdAt)}
            {open && order.expiresAt ? ` · ${formatDateTime(order.expiresAt)}까지` : ''}
          </p>
          {order.reason && order.status !== 'filled' && <p className="text-xs text-sub">{order.reason}</p>}
        </div>
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold ${
            open ? 'bg-brand/10 text-brand' : order.status === 'filled' ? 'bg-soft text-ink' : 'bg-soft text-sub'
          }`}
        >
          {STATUS[order.status]}
        </span>
      </div>

      {open && !editing && (
        <div className="mt-2 flex gap-2">
          {order.type === 'limit' && (
            <button disabled={busy} onClick={() => setEditing(true)} className="flex-1 rounded-lg bg-soft py-2 text-sm font-semibold">
              정정
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => run(() => api.cancelOrder(order.id), '주문을 취소했어요')}
            className="flex-1 rounded-lg bg-soft py-2 text-sm font-semibold text-sub"
          >
            취소
          </button>
        </div>
      )}

      {editing && (
        <div className="mt-2 space-y-2 rounded-xl bg-soft p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-10 text-sub">가격</span>
            <button onClick={() => step(-1)} className="px-2 text-lg text-sub">−</button>
            <input
              value={priceText}
              inputMode={order.market === 'US' ? 'decimal' : 'numeric'}
              onChange={(e) => setPriceText(formatNumberInput(order.market === 'US' ? e.target.value : e.target.value.replace(/\./g, '')))}
              className="w-full rounded-lg bg-card px-2 py-1.5 text-center font-semibold outline-none"
            />
            <button onClick={() => step(1)} className="px-2 text-lg text-sub">+</button>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="w-10 text-sub">수량</span>
            <input
              value={qtyText}
              inputMode="numeric"
              onChange={(e) => setQtyText(e.target.value.replace(/[^0-9]/g, ''))}
              className="w-full rounded-lg bg-card px-2 py-1.5 text-center font-semibold outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="flex-1 rounded-lg bg-card py-2 text-sm font-semibold text-sub">
              닫기
            </button>
            <button
              disabled={busy}
              onClick={() => run(() => api.amendOrder(order.id, { limitPrice: price, qty: Number(qtyText) }), '주문을 정정했어요')}
              className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white"
            >
              정정하기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
