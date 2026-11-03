import { useState } from 'react';
import { useAccount } from '../lib/account';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';
import { Card, SectionTitle } from './Layout';

/** 일지 탭 > 코치: 규칙 기반 습관 분석 + 손절 원칙 설정 */
export function CoachPanel({ askAi }: { askAi?: React.ReactNode }) {
  const acct = useAccount();
  const [nonce, setNonce] = useState(0);
  const { data, error } = useAsync(() => api.coach(), [acct, nonce]);

  return (
    <>
      <StopLossSetting current={data?.stopLossRate} onSaved={() => setNonce((n) => n + 1)} />

      {error && <p className="py-4 text-center text-sm text-sub">{error.message}</p>}
      {data && (
        <Card>
          <SectionTitle>내 매매 습관</SectionTitle>
          {data.report.findings.length === 0 && !data.concentration?.triggered ? (
            <p className="text-sm text-sub">거래가 더 쌓이면 습관을 분석해 드려요 (규칙마다 최소 3건)</p>
          ) : (
            <ul className="space-y-3">
              {data.concentration?.triggered && (
                <Finding warn title="집중 투자" message={`자산의 ${Math.round(data.concentration.weight * 100)}%가 한 종목(${data.concentration.code})에 몰려 있어요`} />
              )}
              {data.report.findings.map((f) => (
                <Finding key={f.rule} warn={f.triggered} title={f.title} message={f.message} />
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-sub">{data.report.disclaimer}</p>
        </Card>
      )}

      {askAi}
    </>
  );
}

function Finding({ warn, title, message }: { warn: boolean; title: string; message: string }) {
  return (
    <li className={`rounded-xl px-3 py-2.5 ${warn ? 'bg-up/10' : 'bg-soft'}`}>
      <p className="text-sm font-semibold">
        {warn ? '⚠️ ' : '✅ '}
        {title}
      </p>
      <p className="mt-0.5 text-sm text-sub">{message}</p>
    </li>
  );
}

/** 내 손절 원칙 (예: -5%) — 코치가 이 기준으로 손절 미준수를 확인 */
function StopLossSetting({ current, onSaved }: { current?: number; onSaved: () => void }) {
  const [text, setText] = useState('');
  const shown = current !== undefined ? String(Math.round(-current * 1000) / 10) : '';
  const save = async (value: number | null) => {
    try {
      await api.saveSettings({ stopLossRate: value });
      toast(value === null ? '손절 원칙을 지웠어요' : `손절 원칙: -${Math.abs(value * 100)}%`);
      setText('');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <Card className="py-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm font-semibold">내 손절 원칙</p>
        <span className="text-sm text-sub">-</span>
        <input
          value={text}
          placeholder={shown || '5'}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ''))}
          className="w-16 rounded-lg bg-soft px-2 py-1.5 text-right font-semibold outline-none placeholder:text-sub"
        />
        <span className="text-sm text-sub">%</span>
        <button disabled={!(Number(text) > 0 && Number(text) < 100)} onClick={() => save(-Number(text) / 100)} className="text-sm font-semibold text-brand disabled:text-sub">
          저장
        </button>
        {current !== undefined && (
          <button onClick={() => save(null)} className="text-sm text-sub">
            지우기
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-sub">{current !== undefined ? `지금 원칙: -${shown}%에서 손절` : '정해두면 코치가 원칙을 지켰는지 확인해요'}</p>
    </Card>
  );
}
