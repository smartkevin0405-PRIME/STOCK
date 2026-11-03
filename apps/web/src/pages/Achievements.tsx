import type { Achievement, Challenge, ChallengeStatus } from '@stock/shared';
import { useState } from 'react';
import { Card, SectionTitle, SubPage } from '../components/Layout';
import { saveStopLossRate, useAchievementVersion } from '../lib/achievements';
import { api } from '../lib/api';
import { formatRate } from '../lib/format';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';

const day = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' });
const pct = (rate: number) => `${Math.round(rate * 100)}%`;

const STATUS: Record<ChallengeStatus, { text: string; className: string }> = {
  active: { text: '진행 중', className: 'bg-brand/10 text-brand' },
  done: { text: '달성', className: 'bg-brand text-white' },
  failed: { text: '이번 달 실패', className: 'bg-soft text-sub' },
  needsSetting: { text: '설정 필요', className: 'bg-soft text-sub' },
};

const STOP_CHOICES = [-0.03, -0.05, -0.07, -0.1];

/** 챌린지마다 지금 값 설명 */
function detail(c: Challenge): string {
  if (c.id === 'profit5') return `지금 ${formatRate(c.value)} · 목표 +${pct(c.target)}`;
  if (c.id === 'mdd10') return `지금 최대 낙폭 ${formatRate(c.value)} · 한도 ${pct(c.target)}`;
  return `${c.value} / ${c.target}${c.id === 'journal10' ? '개' : '번'}`;
}

function ChallengeRow({ c, onSet }: { c: Challenge; onSet: (rate: number) => void }) {
  const status = STATUS[c.status];
  return (
    <div className="py-3">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-soft text-xl">{c.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{c.title}</p>
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${status.className}`}>{status.text}</span>
          </div>
          <p className="mt-0.5 text-[13px] text-sub">{c.status === 'needsSetting' ? c.hint ?? c.desc : detail(c)}</p>
        </div>
      </div>
      {c.status === 'needsSetting' ? (
        <div className="mt-3 flex gap-1.5 pl-[52px]">
          {STOP_CHOICES.map((r) => (
            <button key={r} onClick={() => onSet(r)} className="flex-1 rounded-lg bg-soft py-1.5 text-[13px] font-semibold">
              {pct(r)}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-2.5 ml-[52px] h-1.5 overflow-hidden rounded-full bg-soft">
          <div
            className={`h-full rounded-full transition-all ${c.status === 'failed' ? 'bg-sub/40' : 'bg-brand'}`}
            style={{ width: `${Math.round((c.status === 'failed' ? 1 : c.progress) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Badge({ a }: { a: Achievement }) {
  const unlocked = a.unlockedAt !== undefined;
  return (
    <div className={`flex flex-col items-center rounded-2xl px-1.5 py-3 text-center ${unlocked ? 'bg-brand/5' : 'bg-soft/60'}`}>
      <span className={`text-[32px] leading-none ${unlocked ? '' : 'opacity-30 grayscale'}`}>{a.icon}</span>
      <p className={`mt-2 text-[13px] font-semibold leading-tight ${unlocked ? '' : 'text-sub'}`}>{a.title}</p>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-sub">{a.desc}</p>
      <p className={`mt-1.5 text-[11px] font-medium ${unlocked ? 'text-brand' : 'text-sub'}`}>
        {unlocked ? day(a.unlockedAt!) : a.progress !== undefined && a.progress > 0 ? `${Math.round(a.progress * 100)}%` : '잠김'}
      </p>
    </div>
  );
}

export function Achievements() {
  const version = useAchievementVersion();
  const { data, error } = useAsync(() => api.achievements(), [version]);

  const setStop = async (rate: number) => {
    try {
      await saveStopLossRate(rate);
      toast(`손절 기준을 ${pct(rate)}로 정했어요`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const unlockedCount = data?.achievements.filter((a) => a.unlockedAt !== undefined).length ?? 0;
  const total = data?.achievements.length ?? 0;
  const first = data?.challenges[0];
  const month = first ? Number(first.month.slice(5)) : undefined;
  const daysLeft = first ? Math.max(0, Math.ceil((first.endsAt - Date.now()) / 86_400_000)) : undefined;

  return (
    <SubPage title="챌린지 · 업적">
      {error && <p className="px-2 text-sm text-sub">{error.message}</p>}

      <Card>
        <SectionTitle right={daysLeft !== undefined && <span className="text-[13px] text-sub">{daysLeft}일 남음</span>}>
          {month ? `${month}월 챌린지` : '이번 달 챌린지'}
        </SectionTitle>
        <div className="-my-3 divide-y divide-line">
          {data?.challenges.map((c) => <ChallengeRow key={c.id} c={c} onSet={setStop} />) ?? <p className="py-3 text-sm text-sub">불러오는 중…</p>}
        </div>
      </Card>

      <Card>
        <SectionTitle right={data && <span className="text-[13px] text-sub">{unlockedCount} / {total}</span>}>업적 배지</SectionTitle>
        <div className="grid grid-cols-3 gap-2">
          {data?.achievements.map((a) => <Badge key={a.id} a={a} />)}
        </div>
        <p className="mt-3 text-xs text-sub">한 번 받은 배지는 계좌를 리셋해도 남아요.</p>
      </Card>
    </SubPage>
  );
}
