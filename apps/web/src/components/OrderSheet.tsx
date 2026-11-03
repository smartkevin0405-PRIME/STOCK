import { DEFAULT_CONFIG, getMarketStatus, priceLimits, roundToTick, tickSize, validateOrder } from '@stock/core';
import type { OrderSide, OrderType, Quote, StockInfo } from '@stock/shared';
import { useState, type ReactNode } from 'react';
import { DEMO_ACCOUNT } from '../lib/account';
import { formatDateTime, formatMoney, formatNumberInput, formatPrice, parseNumberInput } from '../lib/format';
import { CloseIcon } from './Icons';
import { Segmented, Soon } from './Layout';

interface Props {
  stock: StockInfo;
  quote: Quote;
  initialSide: OrderSide;
  onClose: () => void;
}

export function OrderSheet({ stock, quote, initialSide, onClose }: Props) {
  const market = stock.market;
  const [side, setSide] = useState<OrderSide>(initialSide);
  const [type, setType] = useState<OrderType>('limit');
  const [priceText, setPriceText] = useState(() => formatNumberInput(String(quote.price)));
  const [qtyText, setQtyText] = useState('1');
  const price = parseNumberInput(priceText);
  const qty = parseNumberInput(qtyText);
  const setPrice = (p: number) => setPriceText(formatNumberInput(String(p)));
  const setQty = (q: number) => setQtyText(formatNumberInput(String(q)));

  const account = DEMO_ACCOUNT;
  const position = account.positions[stock.code];
  const status = getMarketStatus(market);
  const limits = priceLimits(market, quote.prevClose);

  const result = validateOrder(
    { stock, side, type, qty, limitPrice: type === 'limit' ? price : undefined },
    { quote, cash: account.cash, position },
  );
  const estimate = result.estimate;

  const stepPrice = (dir: 1 | -1) => {
    const tick = dir > 0 ? tickSize(market, price) : tickSize(market, price - 1e-9);
    setPrice(roundToTick(market, price + dir * tick, 'nearest'));
  };

  const maxQty = () => {
    if (side === 'sell') return position?.qty ?? 0;
    const unit = (type === 'limit' ? price : quote.price) * (1 + DEFAULT_CONFIG.slippageRate);
    const rate = market === 'KR' ? DEFAULT_CONFIG.krCommissionRate : DEFAULT_CONFIG.usCommissionRate;
    return Math.max(0, Math.floor(account.cash[stock.currency] / (unit * (1 + rate))));
  };

  const accent = side === 'buy' ? 'bg-up' : 'bg-down';

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-[480px] rounded-t-3xl bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-5"
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
          <Segmented options={[{ value: 'buy', label: '구매' }, { value: 'sell', label: '판매' }] as const} value={side} onChange={setSide} />
          <Segmented size="sm" options={[{ value: 'limit', label: '지정가' }, { value: 'market', label: '시장가' }] as const} value={type} onChange={setType} />

          {type === 'limit' ? (
            <Field label="가격">
              <Stepper onMinus={() => stepPrice(-1)} onPlus={() => stepPrice(1)}>
                <input
                  inputMode={market === 'US' ? 'decimal' : 'numeric'}
                  value={priceText}
                  onChange={(e) => setPriceText(formatNumberInput(market === 'US' ? e.target.value : e.target.value.replace(/\./g, '')))}
                  className="w-full bg-transparent text-center text-lg font-semibold outline-none"
                />
              </Stepper>
              {limits && (
                <p className="mt-1 text-right text-xs text-sub">
                  상한가 {formatPrice(limits.upper, stock.currency)} · 하한가 {formatPrice(limits.lower, stock.currency)}
                </p>
              )}
            </Field>
          ) : (
            <p className="rounded-xl bg-soft px-4 py-3 text-sm text-sub">
              지금 가격에 바로 {side === 'buy' ? '구매' : '판매'}해요. 실제처럼 약간 불리한 가격(슬리피지)이 적용돼요.
            </p>
          )}

          <Field label="수량" right={<button className="text-xs font-semibold text-brand" onClick={() => setQty(maxQty())}>최대 {maxQty()}주</button>}>
            <Stepper onMinus={() => setQty(Math.max(1, qty - 1))} onPlus={() => setQty(qty + 1)}>
              <input
                inputMode="numeric"
                value={qtyText}
                onChange={(e) => setQtyText(formatNumberInput(e.target.value.replace(/\./g, '')))}
                className="w-full bg-transparent text-center text-lg font-semibold outline-none"
              />
            </Stepper>
          </Field>

          {estimate && (
            <dl className="space-y-1.5 rounded-xl bg-soft px-4 py-3 text-sm">
              <Row k="예상 체결가" v={formatPrice(estimate.price, stock.currency)} />
              <Row k="주문 금액" v={formatMoney(estimate.amount, stock.currency)} />
              <Row k="수수료" v={formatMoney(estimate.commission, stock.currency)} />
              {side === 'sell' && <Row k="세금" v={formatMoney(estimate.tax, stock.currency)} />}
              <Row k={side === 'buy' ? '총 필요 금액' : '받을 금액'} v={formatMoney(estimate.total, stock.currency)} strong />
              <Row
                k={side === 'buy' ? '주문 가능' : '판매 가능'}
                v={side === 'buy' ? formatMoney(account.cash[stock.currency], stock.currency) : `${position?.qty ?? 0}주`}
              />
            </dl>
          )}

          {!result.ok && <p className="text-sm font-medium text-up">{result.message}</p>}
          {status.state === 'closed' && (
            <p className="text-xs text-sub">
              지금은 장이 닫혀 있어요. 주문하면 예약주문으로 저장돼서 다음 장 시작({formatDateTime(status.nextOpen)})에 처리돼요.
            </p>
          )}

          <button disabled className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-bold text-white opacity-50 ${accent}`}>
            {side === 'buy' ? '구매하기' : '판매하기'} <Soon milestone="M2에서 열려요" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm text-sub">
        <span>{label}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function Stepper({ onMinus, onPlus, children }: { onMinus: () => void; onPlus: () => void; children: ReactNode }) {
  return (
    <div className="flex items-center rounded-xl bg-soft">
      <button onClick={onMinus} className="px-5 py-3 text-xl text-sub" aria-label="빼기">−</button>
      {children}
      <button onClick={onPlus} className="px-5 py-3 text-xl text-sub" aria-label="더하기">+</button>
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
