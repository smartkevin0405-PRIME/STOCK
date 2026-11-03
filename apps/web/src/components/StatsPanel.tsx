import { useAccount } from '../lib/account';
import { api, type StatsPeriod } from '../lib/api';
import { changeColor, formatMoney, formatRate, formatSigned } from '../lib/format';
import { useStored } from '../lib/storage';
import { useTheme } from '../lib/theme';
import { useAsync } from '../lib/useAsync';
import { EquityChart } from './EquityChart';
import { Card, Empty, Segmented, SectionTitle } from './Layout';
import { ProfitCalendar } from './ProfitCalendar';

const won = (v: number) => `${formatSigned(Math.round(v), 'KRW')}원`;

/** 일지 탭 > 통계: 매매 성적, 자산 추이, 최대 낙폭, 수익 캘린더, 양도세 예상 */
export function StatsPanel() {
  const [period, setPeriod] = useStored<StatsPeriod>('stats-period', 'all');
  const acct = useAccount(); // 체결되면 다시 계산
  const { data, error } = useAsync(() => api.stats(period), [period, acct]);
  const { dark } = useTheme();

  if (error) return <Empty title="통계를 불러오지 못했어요" desc={error.message} />;
  if (!data) return <p className="py-8 text-center text-sub">불러오는 중…</p>;
  const t = data.trades;
  const dd = data.drawdown;

  const items: [string, string, number?][] = [
    ['승률', t.winRate === null ? '-' : `${Math.round(t.winRate * 100)}% (${t.wins}승 ${t.losses}패)`],
    ['손익비', t.payoffRatio === null || t.wins === 0 || t.losses === 0 ? '-' : `${t.payoffRatio.toFixed(2)}`],
    ['평균 수익', t.avgWinKrw === null ? '-' : won(t.avgWinKrw), t.avgWinKrw ?? 0],
    ['평균 손실', t.avgLossKrw === null ? '-' : won(t.avgLossKrw), t.avgLossKrw ?? 0],
    ['실현손익 합계', won(t.totalPnlKrw), t.totalPnlKrw],
    ['최대 연승 · 연패', `${t.maxWinStreak}연승 · ${t.maxLossStreak}연패`],
    ['평균 보유기간', t.holding ? `${t.holding.avgDays < 1 ? '1일 미만' : `${Math.round(t.holding.avgDays * 10) / 10}일`}` : '-'],
    ['판매 횟수', `${t.count}회`],
  ];

  return (
    <>
      <Segmented
        size="sm"
        options={[
          { value: 'all', label: '이번 시즌' },
          { value: 'month', label: '이번 달' },
          { value: 'week', label: '이번 주' },
        ]}
        value={period}
        onChange={setPeriod}
      />

      <Card>
        <SectionTitle>매매 성적</SectionTitle>
        {t.count === 0 ? (
          <p className="text-sm text-sub">판매한 거래가 생기면 승률·손익비가 계산돼요</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {items.map(([k, v, tone]) => (
              <div key={k}>
                <dt className="text-xs text-sub">{k}</dt>
                <dd className={`font-semibold ${tone !== undefined ? changeColor(tone) : ''}`}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-xs text-sub">손익비 = 평균 수익 ÷ 평균 손실. 1보다 크면 이길 때 더 많이 벌어요.</p>
      </Card>

      <Card>
        <SectionTitle>자산 추이</SectionTitle>
        <EquityChart equity={data.equity} dark={dark} />
        {dd && dd.mdd < 0 && (
          <p className="mt-3 text-sm">
            최대 낙폭 <span className="font-semibold text-down">{formatRate(dd.mdd)}</span>
            <span className="text-sub"> · 지금은 고점 대비 {formatRate(dd.current)}</span>
          </p>
        )}
      </Card>

      <Card>
        <SectionTitle>수익 캘린더</SectionTitle>
        <ProfitCalendar days={data.calendar} />
      </Card>

      {data.tax.usRealizedKrw !== 0 && (
        <Card>
          <SectionTitle>미국주식 양도세 ({data.tax.year}년 예상)</SectionTitle>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-sub">실현손익 (지금 환율로 환산)</dt>
              <dd className={`font-medium ${changeColor(data.tax.usRealizedKrw)}`}>{won(data.tax.usRealizedKrw)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sub">기본공제</dt>
              <dd className="font-medium">{formatMoney(data.tax.deductionKrw, 'KRW')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sub">예상 세금 (22%)</dt>
              <dd className="font-bold">{formatMoney(data.tax.estimatedTaxKrw, 'KRW')}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-sub">실제 세금은 거래한 날 환율 기준이라 조금 달라요. 모의투자라 실제로 내지는 않아요.</p>
        </Card>
      )}
    </>
  );
}
