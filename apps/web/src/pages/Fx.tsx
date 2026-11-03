import { quoteFx } from '@stock/core';
import type { Currency } from '@stock/shared';
import { useState } from 'react';
import { Card, Segmented, SectionTitle, SubPage } from '../components/Layout';
import { account, useAccount } from '../lib/account';
import { api } from '../lib/api';
import { formatDateTime, formatMoney, formatNumberInput, parseNumberInput } from '../lib/format';
import { useUsdKrw } from '../lib/live';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';

export function Fx() {
  const acct = useAccount();
  const usdKrw = useUsdKrw();
  const base = useAsync(() => (usdKrw ? Promise.resolve(usdKrw) : api.indices().then((r) => r.usdKrw)), []);
  const rate = usdKrw ?? base.data;
  const [from, setFrom] = useState<Currency>('KRW');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useAsync(() => api.fxTrades(), [acct]);

  const amount = parseNumberInput(text);
  const to: Currency = from === 'KRW' ? 'USD' : 'KRW';
  const available = acct?.available[from] ?? 0;
  const preview = rate && amount > 0 ? quoteFx(from, amount, rate) : undefined;
  const error = amount > available ? '환전 가능한 금액이 부족해요' : undefined;

  const submit = async () => {
    setBusy(true);
    try {
      const { trade } = await api.exchange(from, amount);
      toast(`${formatMoney(trade.pay, trade.from)} → ${formatMoney(trade.receive, trade.to)} 환전했어요`);
      setText('');
      await account.refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SubPage title="환전">
      <Card className="space-y-4">
        <Segmented
          options={[
            { value: 'KRW', label: '원 → 달러' },
            { value: 'USD', label: '달러 → 원' },
          ]}
          value={from}
          onChange={(v) => {
            setFrom(v);
            setText('');
          }}
        />
        <div>
          <div className="mb-1 flex justify-between text-sm text-sub">
            <span>보낼 금액 ({from === 'KRW' ? '원' : '달러'})</span>
            <button className="font-semibold text-brand" onClick={() => setText(formatNumberInput(String(available)))}>
              전부 {formatMoney(available, from)}
            </button>
          </div>
          <input
            value={text}
            inputMode={from === 'USD' ? 'decimal' : 'numeric'}
            placeholder="0"
            onChange={(e) => setText(formatNumberInput(from === 'USD' ? e.target.value : e.target.value.replace(/\./g, '')))}
            className="w-full rounded-xl bg-soft px-4 py-3 text-right text-xl font-semibold outline-none placeholder:text-sub"
          />
        </div>
        <dl className="space-y-1.5 rounded-xl bg-soft px-4 py-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-sub">기준 환율</dt>
            <dd className="font-medium">{rate ? `${rate.toFixed(2)}원` : '…'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sub">적용 환율 (스프레드 1%)</dt>
            <dd className="font-medium">{preview ? `${preview.rate.toFixed(2)}원` : '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-sub">받을 금액</dt>
            <dd className="font-bold">{preview ? formatMoney(preview.receive, to) : '-'}</dd>
          </div>
        </dl>
        {error && <p className="text-sm font-medium text-up">{error}</p>}
        <button
          disabled={!preview || preview.receive <= 0 || !!error || busy}
          onClick={submit}
          className="w-full rounded-2xl bg-brand py-4 font-bold text-white disabled:opacity-40"
        >
          {busy ? '환전 중…' : '환전하기'}
        </button>
      </Card>

      <Card className="py-3">
        <SectionTitle>환전 내역</SectionTitle>
        {history.data?.trades.length ? (
          history.data.trades.map((t) => (
            <div key={t.id} className="flex justify-between border-b border-line py-2.5 text-sm last:border-0">
              <div>
                <p className="font-medium">
                  {formatMoney(t.pay, t.from)} → {formatMoney(t.receive, t.to)}
                </p>
                <p className="text-xs text-sub">{formatDateTime(t.executedAt)}</p>
              </div>
              <p className="text-sub">{t.rate.toFixed(2)}원</p>
            </div>
          ))
        ) : (
          <p className="py-4 text-center text-sm text-sub">환전 내역이 없어요</p>
        )}
      </Card>
    </SubPage>
  );
}
