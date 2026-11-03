import { roundToTick } from '@stock/core';
import type { AlertKind, Quote, StockInfo } from '@stock/shared';
import { useState } from 'react';
import { ALERT_KINDS, describeAlert } from '../lib/alerts';
import { api } from '../lib/api';
import { formatNumberInput, formatPrice, parseNumberInput } from '../lib/format';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';
import { CloseIcon } from './Icons';
import { Segmented } from './Layout';

/** 기본값: 가격은 지금 ±5%, 등락률은 5% */
function defaultValue(kind: AlertKind, stock: StockInfo, quote: Quote): string {
  if (kind === 'rise' || kind === 'fall') return '5';
  const raw = quote.price * (kind === 'above' ? 1.05 : 0.95);
  return formatNumberInput(String(roundToTick(stock.market, raw, kind === 'above' ? 'up' : 'down')));
}

/** 종목 화면에서 가격 알림 추가 + 이 종목 알림 목록 */
export function AlertSheet({ stock, quote, onClose }: { stock: StockInfo; quote: Quote; onClose: () => void }) {
  const [kind, setKind] = useState<AlertKind>('above');
  const [text, setText] = useState(() => defaultValue('above', stock, quote));
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const existing = useAsync(() => api.alerts(), [nonce]);
  const mine = existing.data?.alerts.filter((a) => a.code === stock.code && a.active) ?? [];
  const pct = kind === 'rise' || kind === 'fall';
  const value = parseNumberInput(text);

  const submit = async () => {
    setBusy(true);
    try {
      await api.createAlert({ code: stock.code, kind, value });
      toast(`${describeAlert({ kind, value }, stock)}이 되면 알려드릴게요`);
      setNonce((n) => n + 1);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="mx-auto max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{stock.nameKo} 가격 알림</h2>
          <button onClick={onClose} aria-label="닫기" className="text-sub">
            <CloseIcon />
          </button>
        </div>
        <div className="space-y-3">
          <Segmented
            options={ALERT_KINDS}
            value={kind}
            onChange={(k) => {
              setKind(k);
              setText(defaultValue(k, stock, quote));
            }}
          />
          <div className="flex items-center gap-2 rounded-xl bg-soft px-4 py-3">
            {pct && <span className="text-lg font-semibold text-sub">{kind === 'rise' ? '+' : '-'}</span>}
            <input
              value={text}
              inputMode="decimal"
              onChange={(e) => setText(formatNumberInput(e.target.value))}
              className="w-full bg-transparent text-right text-xl font-semibold outline-none"
            />
            <span className="shrink-0 text-sub">{pct ? '%' : stock.currency === 'KRW' ? '원' : '$'}</span>
          </div>
          <p className="text-sm text-sub">
            지금 {formatPrice(quote.price, stock.currency)} (전일 대비 {(quote.changeRate * 100).toFixed(2)}%) ·{' '}
            {value > 0 ? `${describeAlert({ kind, value }, stock)}이 되면 알려드려요` : '값을 입력해주세요'}
          </p>
          <button disabled={busy || !(value > 0)} onClick={submit} className="w-full rounded-2xl bg-brand py-4 font-bold text-white disabled:opacity-40">
            알림 켜기
          </button>

          {mine.length > 0 && (
            <div className="pt-2">
              <p className="mb-1 text-sm font-semibold">켜져 있는 알림</p>
              {mine.map((a) => (
                <div key={a.id} className="flex items-center justify-between border-b border-line py-2.5 text-sm last:border-0">
                  <span>{describeAlert(a, stock)}</span>
                  <button
                    onClick={async () => {
                      await api.deleteAlert(a.id).catch((e: Error) => toast(e.message, 'error'));
                      setNonce((n) => n + 1);
                    }}
                    className="font-semibold text-sub"
                  >
                    끄기
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
