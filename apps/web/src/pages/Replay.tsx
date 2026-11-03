import type { ReplayResult, ReplayScenario } from '@stock/shared';
import { Link } from 'react-router';
import { ChevronIcon } from '../components/Icons';
import { Card, Empty, SectionTitle, SubPage } from '../components/Layout';
import { changeColor, formatMoney, formatRate } from '../lib/format';
import { dotDate, replayApi, replayDateText } from '../lib/replay';
import { savedReplayTime } from '../lib/replayProgress';
import { useAsync } from '../lib/useAsync';

const day = (ms: number) => new Date(ms).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' });

/** 타임머신 리플레이: 시나리오 고르기 + 지난 기록 */
export function Replay() {
  const { data, error } = useAsync(() => Promise.all([replayApi.scenarios(), replayApi.results()]), []);
  if (error) return <SubPage title="타임머신 리플레이"><Empty title="불러오지 못했어요" desc={error.message} /></SubPage>;
  const [info, { results } = { results: [] }] = data ?? [];
  const byId = new Map(info?.scenarios.map((s) => [s.id, s]));
  const best = (id: string) =>
    results.filter((r) => r.scenarioId === id).reduce<ReplayResult | undefined>((b, r) => (!b || r.returnRate > b.returnRate ? r : b), undefined);

  return (
    <SubPage title="타임머신 리플레이">
      <p className="px-1 text-sm text-sub">
        과거 장으로 돌아가 하루씩 넘기며 연습해요. 미래 차트는 보이지 않고, 본 계좌와는 상관없어요.
      </p>

      {!info && <p className="p-8 text-center text-sub">불러오는 중…</p>}
      {info?.scenarios.map((s) => (
        <ScenarioCard key={s.id} s={s} names={s.codes.map((c) => info.stocks[c]?.nameKo ?? c)} best={best(s.id)} />
      ))}

      {info && (
        <Card>
          <SectionTitle>지난 기록</SectionTitle>
          {results.length === 0 ? (
            <p className="py-4 text-center text-sm text-sub">아직 끝까지 해본 리플레이가 없어요</p>
          ) : (
            <ul className="divide-y divide-line">
              {results.map((r) => {
                const s = byId.get(r.scenarioId);
                return (
                  <li key={r.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{s?.title ?? r.scenarioId}</p>
                      <p className="text-xs text-sub">
                        {day(r.finishedAt)} · 거래 {r.tradeCount}회
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${changeColor(r.returnRate)}`}>{formatRate(r.returnRate)}</p>
                      <p className="text-xs text-sub">{formatMoney(r.finalValue, s?.currency ?? 'KRW')}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </SubPage>
  );
}

function ScenarioCard({ s, names, best }: { s: ReplayScenario; names: string[]; best?: ReplayResult }) {
  const saved = savedReplayTime(s.id);
  return (
    <Link to={`/replay/${s.id}`} className="block rounded-2xl bg-card p-5 active:opacity-80">
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold">{s.title}</p>
        <span className="flex items-center gap-1">
          {saved !== undefined && (
            <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-xs font-semibold text-brand">이어하기 · {replayDateText(saved, false)}</span>
          )}
          <ChevronIcon width={18} height={18} className="text-sub" />
        </span>
      </div>
      <p className="mt-0.5 text-xs text-sub">
        {dotDate(s.start)} ~ {dotDate(s.end)} · 시작 {formatMoney(s.startCash, s.currency)}
      </p>
      <p className="mt-2 text-sm">{s.description}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {names.map((n) => (
          <span key={n} className="rounded-md bg-soft px-2 py-0.5 text-xs font-medium text-sub">
            {n}
          </span>
        ))}
      </div>
      {best && (
        <p className="mt-3 text-sm text-sub">
          내 최고 기록 <span className={`font-bold ${changeColor(best.returnRate)}`}>{formatRate(best.returnRate)}</span>
        </p>
      )}
    </Link>
  );
}
