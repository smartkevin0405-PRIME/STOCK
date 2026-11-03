import type { Market } from '@stock/shared';
import { Link } from 'react-router';
import { Card, Empty, Page, SectionTitle, Soon } from '../components/Layout';
import { SEED_KRW } from '../lib/account';
import { api } from '../lib/api';
import { changeColor, formatDateTime, formatIndex, formatMoney, formatRate } from '../lib/format';
import { live, useLiveConnected, useLiveIndices } from '../lib/live';
import { useAsync } from '../lib/useAsync';

export function Home() {
  const health = useAsync(() => api.health(), []);
  const status = useAsync(() => api.marketStatus(), []);
  useAsync(() => api.indices().then((r) => live.seedIndices(r.indices)), []);
  const indices = useLiveIndices();
  const connected = useLiveConnected();

  return (
    <Page
      title="STOCK"
      right={
        <span className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-medium text-sub">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-[#00b386]' : 'bg-sub'}`} />
          {health.data?.provider === 'mock' ? '가짜 시세' : (health.data?.provider ?? '연결 중')}
        </span>
      }
    >
      <Card>
        <p className="text-sm text-sub">내 총자산</p>
        <p className="mt-1 text-[28px] font-bold">{formatMoney(SEED_KRW, 'KRW')}</p>
        <p className="mt-0.5 text-sm text-sub">0원 (0.00%)</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-soft px-3 py-2.5">
            <p className="text-sub">원화</p>
            <p className="font-semibold">{formatMoney(SEED_KRW, 'KRW')}</p>
          </div>
          <div className="rounded-xl bg-soft px-3 py-2.5">
            <p className="text-sub">달러</p>
            <p className="font-semibold">$0.00</p>
          </div>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-sub">
          실제 계좌·수익률 연결 <Soon milestone="M2" />
        </p>
      </Card>

      <Card className="px-0 pb-4">
        <div className="px-5">
          <SectionTitle>시장 지수</SectionTitle>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-5">
          {indices.map((i) => (
            <div key={i.symbol} className="min-w-[120px] rounded-xl bg-soft px-3 py-2.5">
              <p className="text-xs text-sub">{i.name}</p>
              <p className="font-semibold">{formatIndex(i.price)}</p>
              <p className={`text-xs font-medium ${changeColor(i.change)}`}>{formatRate(i.changeRate)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle>장 운영</SectionTitle>
        <div className="space-y-2 text-sm">
          {(['KR', 'US'] as Market[]).map((m) => {
            const s = status.data?.[m];
            return (
              <div key={m} className="flex items-center justify-between">
                <span className="font-medium">{m === 'KR' ? '🇰🇷 국내' : '🇺🇸 미국'}</span>
                {s ? (
                  s.state === 'open' ? (
                    <span className="font-semibold text-up">거래 중 · {formatDateTime(s.closeAt!)} 마감</span>
                  ) : (
                    <span className="text-sub">닫힘 · {formatDateTime(s.nextOpen)} 개장</span>
                  )
                ) : (
                  <span className="text-sub">…</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <SectionTitle>보유 주식</SectionTitle>
        <Empty
          title="아직 보유한 주식이 없어요"
          desc="1,000만원으로 첫 투자를 시작해보세요"
          action={
            <Link to="/discover" className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white">
              종목 둘러보기
            </Link>
          }
        />
      </Card>
    </Page>
  );
}
