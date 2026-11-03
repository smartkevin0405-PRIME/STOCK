import { useState } from 'react';
import { Card, SubPage } from '../components/Layout';
import { account, useAccount, usePortfolio } from '../lib/account';
import { api } from '../lib/api';
import { changeColor, formatMoney, formatRate } from '../lib/format';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';

const day = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' });

export function Seasons() {
  const acct = useAccount();
  const pf = usePortfolio(acct);
  const { data } = useAsync(() => api.seasons(), [acct?.season]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    try {
      const v = await api.resetAccount();
      toast(`시즌 ${v.season} 시작! 1,000만원이 다시 들어왔어요`);
      setConfirming(false);
      await account.refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SubPage title="시즌 기록">
      {data?.seasons.map((s) => {
        const current = !s.endedAt;
        const final = current ? pf?.totalKrw : s.finalKrw;
        const rate = final !== undefined ? (final - s.seedKrw) / s.seedKrw : undefined;
        return (
          <Card key={s.season}>
            <div className="flex items-center justify-between">
              <p className="font-bold">
                시즌 {s.season} {current && <span className="ml-1 rounded-md bg-brand/10 px-1.5 py-0.5 text-xs text-brand">진행 중</span>}
              </p>
              <p className="text-xs text-sub">
                {day(s.startedAt)} ~ {s.endedAt ? day(s.endedAt) : ''}
              </p>
            </div>
            <div className="mt-2 flex items-end justify-between">
              <div className="text-sm text-sub">
                {formatMoney(s.seedKrw, 'KRW')} → <span className="font-semibold text-ink">{final !== undefined ? formatMoney(final, 'KRW') : '…'}</span>
                <p className="text-xs">거래 {s.trades}회</p>
              </div>
              {rate !== undefined && <p className={`text-lg font-bold ${changeColor(rate)}`}>{formatRate(rate)}</p>}
            </div>
          </Card>
        );
      })}

      <Card>
        <p className="font-semibold">계좌 리셋</p>
        <p className="mt-1 text-sm text-sub">지금 시즌을 마감하고 1,000만원으로 새로 시작해요. 기록은 위에 남고, 미체결 주문은 취소돼요.</p>
        {confirming ? (
          <div className="mt-3 flex gap-2">
            <button onClick={() => setConfirming(false)} className="flex-1 rounded-xl bg-soft py-3 font-semibold text-sub">
              그만두기
            </button>
            <button disabled={busy} onClick={reset} className="flex-1 rounded-xl bg-up py-3 font-semibold text-white">
              {busy ? '리셋 중…' : '정말 리셋'}
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="mt-3 w-full rounded-xl bg-soft py-3 font-semibold">
            리셋하기
          </button>
        )}
      </Card>
    </SubPage>
  );
}
