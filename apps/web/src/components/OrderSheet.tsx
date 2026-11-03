import { DEFAULT_CONFIG, getMarketStatus, priceLimits, roundToTick, tickSize, validateOrder } from '@stock/core';
import type { JournalNote, OrderSide, OrderType, Quote, StockInfo } from '@stock/shared';
import { useState, type ReactNode } from 'react';
import { account, useAccount } from '../lib/account';
import { api } from '../lib/api';
import { formatDateTime, formatMoney, formatNumberInput, formatPrice, parseNumberInput } from '../lib/format';
import { describeFill } from '../lib/notify';
import { toast } from '../lib/toast';
import { CloseIcon } from './Icons';
import { Segmented } from './Layout';
import { NoteEditor } from './NoteEditor';

interface Props {
  stock: StockInfo;
  quote: Quote;
  initialSide: OrderSide;
  onClose: () => void;
}

export function OrderSheet({ stock, quote, initialSide, onClose }: Props) {
  const market = stock.market;
  const acct = useAccount();
  const [side, setSide] = useState<OrderSide>(initialSide);
  const [type, setType] = useState<OrderType>('limit');
  const [priceText, setPriceText] = useState(() => formatNumberInput(String(quote.price)));
  const [qtyText, setQtyText] = useState('1');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState<JournalNote>({ text: '', tags: [] });
  const price = parseNumberInput(priceText);
  const qty = parseNumberInput(qtyText);
  const setPrice = (p: number) => setPriceText(formatNumberInput(String(p)));
  const setQty = (q: number) => setQtyText(formatNumberInput(String(q)));

  // 주문가능금액·판매가능수량은 서버가 미체결 주문까지 빼고 계산해서 줌
  const cash = acct?.available ?? { KRW: 0, USD: 0 };
  const held = acct?.positions.find((p) => p.code === stock.code);
  const sellable = acct?.sellable[stock.code] ?? 0;
  const position = held ? { ...held, qty: sellable } : undefined;
  const status = getMarketStatus(market);
  const limits = priceLimits(market, quote.prevClose);

  const result = validateOrder({ stock, side, type, qty, limitPrice: type === 'limit' ? price : undefined }, { quote, cash, position });
  const estimate = result.estimate;

  const stepPrice = (dir: 1 | -1) => {
    const tick = dir > 0 ? tickSize(market, price) : tickSize(market, price - 1e-9);
    setPrice(roundToTick(market, price + dir * tick, 'nearest'));
  };

  const maxQty = () => {
    if (side === 'sell') return sellable;
    const unit = (type === 'limit' ? price : quote.price) * (1 + DEFAULT_CONFIG.slippageRate);
    const rate = market === 'KR' ? DEFAULT_CONFIG.krCommissionRate : DEFAULT_CONFIG.usCommissionRate;
    return unit > 0 ? Math.max(0, Math.floor(cash[stock.currency] / (unit * (1 + rate)))) : 0;
  };

  const submit = async () => {
    setBusy(true);
    setServerError(undefined);
    try {
      const hasNote = note.text.trim() !== '' || note.tags.length > 0;
      const res = await api.placeOrder({
        code: stock.code,
        side,
        type,
        qty,
        ...(type === 'limit' ? { limitPrice: price } : {}),
        ...(hasNote ? { note } : {}),
      });
      if (res.fill) toast(describeFill(res.fill, stock), 'info', `fill:${res.order.id}`);
      else if (res.order.status === 'reserved') toast(`예약주문 접수 · 다음 장 시작(${formatDateTime(status.nextOpen)})에 처리돼요`);
      else toast('주문 접수 · 가격이 닿으면 체결돼요');
      await account.refresh();
      onClose();
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const accent = side === 'buy' ? 'bg-up' : 'bg-down';
  const error = serverError ?? (!result.ok ? result.message : undefined);

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
          <Segmented options={[{ value: 'buy', label: '구매' }, { value: 'sell', label: '판매' }] as const} value={side} onChange={(v) => { setSide(v); setServerError(undefined); }} />
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

          <Field label="수량" right={<button className="text-xs font-semibold text-brand" onClick={() => setQty(maxQty())}>최대 {maxQty().toLocaleString()}주</button>}>
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
                v={side === 'buy' ? formatMoney(cash[stock.currency], stock.currency) : `${sellable.toLocaleString()}주`}
              />
            </dl>
          )}

          {noteOpen ? (
            <NoteEditor value={note} onChange={setNote} />
          ) : (
            <button onClick={() => setNoteOpen(true)} className="text-sm font-medium text-brand">
              + 매매 이유 메모 남기기
            </button>
          )}

          {error && <p className="text-sm font-medium text-up">{error}</p>}
          {status.state === 'closed' && (
            <p className="text-xs text-sub">
              지금은 장이 닫혀 있어요. 주문하면 예약주문으로 저장돼서 다음 장 시작({formatDateTime(status.nextOpen)})에 처리돼요.
            </p>
          )}

          <button
            disabled={!result.ok || busy || !acct}
            onClick={submit}
            className={`w-full rounded-2xl py-4 font-bold text-white transition disabled:opacity-40 ${accent}`}
          >
            {busy ? '주문 중…' : side === 'buy' ? '구매하기' : '판매하기'}
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
