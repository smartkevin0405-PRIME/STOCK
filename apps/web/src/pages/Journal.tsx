import type { JournalEntry, JournalNote, StockInfo } from '@stock/shared';
import { currencyOf } from '@stock/shared';
import { useState } from 'react';
import { Card, Empty, Page, SectionTitle, Soon } from '../components/Layout';
import { NoteEditor } from '../components/NoteEditor';
import { useAccount } from '../lib/account';
import { api } from '../lib/api';
import { changeColor, formatMoney, formatPrice, formatSigned } from '../lib/format';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';

const COACH = [
  { title: '규칙 기반 코치', desc: '추격매수·손절·물타기·과매매 습관 분석' },
  { title: 'AI에게 물어보기', desc: '내 매매 기록을 질문으로 정리해서 복사' },
  { title: 'AI API 연동', desc: '키를 넣으면 앱 안에서 바로 리포트 (선택)' },
];

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

export function Journal() {
  const acct = useAccount(); // 체결되면 다시 불러옴
  const [nonce, setNonce] = useState(0);
  const { data } = useAsync(() => api.journal(), [acct, nonce]);
  const [tag, setTag] = useState<string>();

  const entries = (data?.entries ?? []).filter((e) => !tag || e.note?.tags.includes(tag));
  const usedTags = [...new Set((data?.entries ?? []).flatMap((e) => e.note?.tags ?? []))];

  // 날짜별로 묶기
  const days: { label: string; items: JournalEntry[] }[] = [];
  for (const e of entries) {
    const label = dayLabel(e.fills[e.fills.length - 1]?.executedAt ?? e.order.createdAt);
    const last = days[days.length - 1];
    if (last?.label === label) last.items.push(e);
    else days.push({ label, items: [e] });
  }

  return (
    <Page title="일지">
      {usedTags.length > 0 && (
        <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
          <TagChip active={!tag} onClick={() => setTag(undefined)}>
            전체
          </TagChip>
          {usedTags.map((t) => (
            <TagChip key={t} active={tag === t} onClick={() => setTag(tag === t ? undefined : t)}>
              #{t}
            </TagChip>
          ))}
        </div>
      )}

      {data && entries.length === 0 ? (
        <Card>
          <Empty title={tag ? `#${tag} 기록이 없어요` : '아직 매매 기록이 없어요'} desc="사고팔 때마다 이유를 남기면 여기에 쌓여요" />
        </Card>
      ) : (
        days.map((d) => (
          <Card key={d.label} className="py-3">
            <p className="mb-1 text-sm font-semibold text-sub">{d.label}</p>
            {d.items.map((e) => (
              <EntryRow key={e.order.id} entry={e} stock={data?.stocks[e.order.code]} onSaved={() => setNonce((n) => n + 1)} />
            ))}
          </Card>
        ))
      )}

      <Card>
        <SectionTitle right={<Soon milestone="M3" />}>통계 · 수익 캘린더</SectionTitle>
        <p className="text-sm text-sub">승률, 손익비, 최대 낙폭, 코스피·S&P500 대비 성과, 월별 수익 달력</p>
      </Card>
      <Card>
        <SectionTitle right={<Soon milestone="M5" />}>투자 코치</SectionTitle>
        <ul className="space-y-3">
          {COACH.map((c) => (
            <li key={c.title}>
              <p className="font-semibold">{c.title}</p>
              <p className="text-sm text-sub">{c.desc}</p>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium ${active ? 'bg-ink text-card' : 'bg-card text-sub'}`}>
      {children}
    </button>
  );
}

function EntryRow({ entry, stock, onSaved }: { entry: JournalEntry; stock?: StockInfo; onSaved: () => void }) {
  const { order, fills, note } = entry;
  const ccy = currencyOf(order.market);
  const qty = fills.reduce((s, f) => s + f.qty, 0);
  const amount = fills.reduce((s, f) => s + f.amount, 0);
  const avg = qty ? amount / qty : 0;
  const pnl = fills.reduce((s, f) => s + (f.realizedPnl ?? 0), 0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<JournalNote>(note ?? { text: '', tags: [] });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.saveNote(order.id, draft);
      toast('메모를 저장했어요');
      setEditing(false);
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-line py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{stock?.nameKo ?? order.code}</p>
          <p className="text-[13px] text-sub">
            <span className={order.side === 'buy' ? 'text-up' : 'text-down'}>{order.side === 'buy' ? '구매' : '판매'}</span> · {qty.toLocaleString()}주 ×{' '}
            {formatPrice(avg, ccy)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold">{formatMoney(amount, ccy)}</p>
          {order.side === 'sell' && (
            <p className={`text-[13px] font-medium ${changeColor(pnl)}`}>
              {formatSigned(pnl, ccy)}
              {ccy === 'KRW' ? '원' : ''}
            </p>
          )}
        </div>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <NoteEditor value={draft} onChange={setDraft} />
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="flex-1 rounded-lg bg-soft py-2 text-sm font-semibold text-sub">
              닫기
            </button>
            <button disabled={busy} onClick={save} className="flex-1 rounded-lg bg-brand py-2 text-sm font-semibold text-white">
              저장
            </button>
          </div>
        </div>
      ) : note && (note.text || note.tags.length) ? (
        <button onClick={() => setEditing(true)} className="mt-2 block w-full rounded-xl bg-soft px-3 py-2 text-left text-sm">
          {note.tags.length > 0 && <span className="mr-1.5 text-brand">{note.tags.map((t) => `#${t}`).join(' ')}</span>}
          {note.text}
        </button>
      ) : (
        <button onClick={() => setEditing(true)} className="mt-1 text-[13px] font-medium text-brand">
          + 이유 남기기
        </button>
      )}
    </div>
  );
}
