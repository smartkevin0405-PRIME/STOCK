import { estimateReplayOrder, maxReplayBuyQty, type ReplayAccount } from '@stock/core';
import type { OrderSide, StockInfo } from '@stock/shared';
import { useState } from 'react';
import { formatMoney, formatNumberInput, formatPrice, parseNumberInput } from '../lib/format';
import { CloseIcon } from './Icons';
import { Segmented } from './Layout';

interface Props {
  stock: StockInfo;
  account: ReplayAccount;
  /** 오늘 종가 */
  close: number;
  dateText: string;
  initialSide: OrderSide;
  /** 주문 실행. 실패하면 이유 문자열 */
  onSubmit: (side: OrderSide, qty: number) => string | undefined;
  onClose: () => void;
}

/** 리플레이 주문: 그날 종가로 시장가 체결 */
export function ReplayOrderSheet({ stock, account, close, dateText, initialSide, onSubmit, onClose }: Props) {
  const ccy = stock.currency;
  const [side, setSide] = useState<OrderSide>(initialSide);
  const [qtyText, setQtyText] = useState('1');
  const [error, setError] = useState<string>();
  const qty = parseNumberInput(qtyText);
  const setQty = (q: number) => setQtyText(formatNumberInput(String(q)));

  const held = account.positions[stock.code]?.qty ?? 0;
  const max = side === 'buy' ? maxReplayBuyQty(account, close) : held;
  const est = qty > 0 ? estimateReplayOrder(stock.market, side, qty, close) : undefined;
  const problem =
    qty <= 0 ? '수량을 정해주세요' : side === 'buy' ? (est && est.total > account.cash ? '돈이 부족해요' : undefined) : qty > held ? `판매 가능 수량은 ${held}주예요` : undefined;

  const submit = () => {
    const err = onSubmit(side, qty);
    if (err) setError(err);
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="mx-auto max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {stock.nameKo} {side === 'buy' ? '구매' : '판매'}
          </h2>
          <button onClick={onClose} aria-label="닫기" className="text-sub">
            <CloseIcon />
          </button>
        </div>

        <div className="space-y-3">
          <Segmented
            options={[{ value: 'buy', label: '구매' }, { value: 'sell', label: '판매' }] as const}
            value={side}
            onChange={(v) => {
              setSide(v);
              setError(undefined);
            }}
          />
          <p className="rounded-xl bg-soft px-4 py-3 text-sm text-sub">
            {dateText} 종가 {formatPrice(close, ccy)}에 약간 불리한 가격(슬리피지)으로 바로 {side === 'buy' ? '구매' : '판매'}해요.
          </p>

          <div>
            <div className="mb-1 flex items-center justify-between text-sm text-sub">
              <span>수량</span>
              <button className="text-xs font-semibold text-brand" onClick={() => setQty(max)}>
                최대 {max.toLocaleString()}주
              </button>
            </div>
            <div className="flex items-center rounded-xl bg-soft">
              <button onClick={() => setQty(Math.max(1, qty - 1))} className="px-5 py-3 text-xl text-sub" aria-label="빼기">
                −
              </button>
              <input
                inputMode="numeric"
                aria-label="수량"
                value={qtyText}
                onChange={(e) => {
                  setQtyText(formatNumberInput(e.target.value.replace(/\./g, '')));
                  setError(undefined);
                }}
                className="w-full bg-transparent text-center text-lg font-semibold outline-none"
              />
              <button onClick={() => setQty(qty + 1)} className="px-5 py-3 text-xl text-sub" aria-label="더하기">
                +
              </button>
            </div>
          </div>

          {est && (
            <dl className="space-y-1.5 rounded-xl bg-soft px-4 py-3 text-sm">
              <Row k="예상 체결가" v={formatPrice(est.price, ccy)} />
              <Row k="주문 금액" v={formatMoney(est.amount, ccy)} />
              <Row k="수수료" v={formatMoney(est.commission, ccy)} />
              {side === 'sell' && <Row k="세금" v={formatMoney(est.tax, ccy)} />}
              <Row k={side === 'buy' ? '총 필요 금액' : '받을 금액'} v={formatMoney(est.total, ccy)} strong />
              <Row k={side === 'buy' ? '주문 가능' : '판매 가능'} v={side === 'buy' ? formatMoney(account.cash, ccy) : `${held.toLocaleString()}주`} />
            </dl>
          )}

          {(error ?? problem) && qty > 0 && <p className="text-sm font-medium text-up">{error ?? problem}</p>}

          <button
            disabled={!!problem}
            onClick={submit}
            className={`w-full rounded-2xl py-4 font-bold text-white transition disabled:opacity-40 ${side === 'buy' ? 'bg-up' : 'bg-down'}`}
          >
            {side === 'buy' ? '구매하기' : '판매하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-sub">{k}</dt>
      <dd className={strong ? 'font-bold' : 'font-medium'}>{v}</dd>
    </div>
  );
}
