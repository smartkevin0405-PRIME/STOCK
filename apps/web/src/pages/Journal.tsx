import type { JournalEntry, JournalNote, StockInfo } from '@stock/shared';
import { currencyOf } from '@stock/shared';
import { useState } from 'react';
import { AskAi } from '../components/AskAi';
import { CoachPanel } from '../components/CoachPanel';
import { Card, Empty, Page, Segmented } from '../components/Layout';
import { NoteEditor } from '../components/NoteEditor';
import { StatsPanel } from '../components/StatsPanel';
import { useStored } from '../lib/storage';
import { useAccount } from '../lib/account';
import { api } from '../lib/api';
import { changeColor, formatMoney, formatPrice, formatSigned } from '../lib/format';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';

const dayLabel = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

function JournalList() {
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
    <>
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

    </>
  );
}

type Tab = 'journal' | 'stats' | 'coach';

export function Journal() {
  const [tab, setTab] = useStored<Tab>('journal-tab', 'journal');
  return (
    <Page title="일지">
      <Segmented
        options={[
          { value: 'journal', label: '매매일지' },
          { value: 'stats', label: '통계' },
          { value: 'coach', label: '코치' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'journal' && <JournalList />}
      {tab === 'stats' && <StatsPanel />}
      {tab === 'coach' && <CoachPanel askAi={<AskAi />} />}
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
