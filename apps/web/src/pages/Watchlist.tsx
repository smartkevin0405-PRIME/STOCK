import type { WatchGroup } from '@stock/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { Card, Empty, Page } from '../components/Layout';
import { StockRow } from '../components/StockRow';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useStored } from '../lib/storage';
import { toast } from '../lib/toast';
import { useWatchlists, watchAction, watchStore } from '../lib/watchlist';

export function Watchlist() {
  const data = useWatchlists();
  const groups = data?.groups ?? [];
  const [selectedId, setSelectedId] = useStored<number | null>('watch-group', null);
  const group = groups.find((g) => g.id === selectedId) ?? groups[0];
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  // 그룹 종목 시세 (처음 한 번, 이후는 실시간)
  const codes = group?.codes.join(',') ?? '';
  const quotes = useAsync(() => (codes ? api.quotes(codes.split(',')) : Promise.resolve({ quotes: [] })), [codes]);
  const quoteOf = (code: string) => quotes.data?.quotes.find((q) => q.code === code) ?? null;

  const createGroup = async () => {
    try {
      const d = await api.createWatchGroup(newName);
      watchStore.set(d);
      setSelectedId(d.groups[d.groups.length - 1]?.id ?? null);
      setAdding(false);
      setNewName('');
      toast('그룹을 만들었어요');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Page
      title="관심"
      right={
        group && (
          <button onClick={() => setEditing(!editing)} className="text-sm font-semibold text-brand">
            {editing ? '완료' : '편집'}
          </button>
        )
      }
    >
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setSelectedId(g.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold ${g.id === group?.id ? 'bg-ink text-card' : 'bg-card text-sub'}`}
          >
            {g.name} {g.codes.length}
          </button>
        ))}
        <button onClick={() => setAdding(true)} className="shrink-0 rounded-full bg-card px-3 py-1.5 text-[13px] font-semibold text-brand">
          + 그룹
        </button>
      </div>

      {adding && (
        <Card className="flex gap-2 py-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createGroup()}
            placeholder="그룹 이름 (예: 반도체)"
            maxLength={20}
            className="min-w-0 flex-1 rounded-lg bg-soft px-3 py-2 text-sm outline-none placeholder:text-sub"
          />
          <button onClick={() => setAdding(false)} className="text-sm font-semibold text-sub">
            취소
          </button>
          <button onClick={createGroup} className="text-sm font-semibold text-brand">
            만들기
          </button>
        </Card>
      )}

      {group && editing ? (
        <GroupEditor key={group.id} group={group} names={data?.stocks ?? {}} canDelete={groups.length > 1} onDeleted={() => setSelectedId(null)} />
      ) : (
        <Card className="py-3">
          {!group || group.codes.length === 0 ? (
            <Empty
              title="종목이 없어요"
              desc="종목 화면에서 ☆를 눌러 담아보세요"
              action={
                <Link to="/discover" className="text-sm font-semibold text-brand">
                  종목 찾기
                </Link>
              }
            />
          ) : (
            group.codes.map((code) => {
              const stock = data?.stocks[code];
              return stock ? <StockRow key={code} stock={stock} quote={quoteOf(code)} /> : null;
            })
          )}
        </Card>
      )}
    </Page>
  );
}

/** 그룹 편집: 이름 변경, 순서 바꾸기, 빼기, 그룹 삭제 */
function GroupEditor({ group, names, canDelete, onDeleted }: { group: WatchGroup; names: Record<string, { nameKo: string }>; canDelete: boolean; onDeleted: () => void }) {
  const [name, setName] = useState(group.name);
  const move = (i: number, dir: -1 | 1) => {
    const codes = [...group.codes];
    const j = i + dir;
    if (j < 0 || j >= codes.length) return;
    [codes[i], codes[j]] = [codes[j]!, codes[i]!];
    void watchAction(() => api.updateWatchGroup(group.id, { codes }));
  };
  return (
    <Card className="space-y-3">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} className="min-w-0 flex-1 rounded-lg bg-soft px-3 py-2 font-semibold outline-none" />
        <button
          disabled={name.trim() === group.name}
          onClick={() => watchAction(() => api.updateWatchGroup(group.id, { name }), '이름을 바꿨어요')}
          className="text-sm font-semibold text-brand disabled:text-sub"
        >
          저장
        </button>
      </div>
      <div>
        {group.codes.map((code, i) => (
          <div key={code} className="flex items-center gap-2 border-b border-line py-2.5 last:border-0">
            <p className="min-w-0 flex-1 truncate font-medium">{names[code]?.nameKo ?? code}</p>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="px-2 text-sub disabled:opacity-30" aria-label="위로">
              ▲
            </button>
            <button onClick={() => move(i, 1)} disabled={i === group.codes.length - 1} className="px-2 text-sub disabled:opacity-30" aria-label="아래로">
              ▼
            </button>
            <button onClick={() => watchAction(() => api.removeWatch(group.id, code))} className="px-2 text-up" aria-label="빼기">
              ✕
            </button>
          </div>
        ))}
      </div>
      {canDelete && (
        <button
          onClick={async () => {
            if (await watchAction(() => api.deleteWatchGroup(group.id), '그룹을 지웠어요')) onDeleted();
          }}
          className="w-full rounded-xl bg-soft py-2.5 text-sm font-semibold text-up"
        >
          이 그룹 지우기
        </button>
      )}
    </Card>
  );
}
