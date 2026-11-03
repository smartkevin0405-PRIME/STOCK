import type { Market } from '@stock/shared';
import { Link } from 'react-router';
import { HoldingRow } from '../components/HoldingRow';
import { ChevronIcon } from '../components/Icons';
import { Card, Empty, Page, SectionTitle } from '../components/Layout';
import { useAccount, usePortfolio } from '../lib/account';
import { api } from '../lib/api';
import { changeColor, formatDateTime, formatIndex, formatMoney, formatRate, formatSigned } from '../lib/format';
import { live, useLiveConnected, useLiveIndices } from '../lib/live';
import { statusLabel, useDataStatus } from '../lib/status';
import { useAsync } from '../lib/useAsync';

export function Home() {
  const dataStatus = useDataStatus();
  const status = useAsync(() => api.marketStatus(), []);
  useAsync(() => api.indices().then((r) => live.seedIndices(r.indices)), []);
  const indices = useLiveIndices();
  const connected = useLiveConnected();
  const acct = useAccount();
  const pf = usePortfolio(acct);

  return (
    <Page
      title="STOCK"
      right={
        <span className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-xs font-medium text-sub">
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-[#00b386]' : 'bg-sub'}`} />
          {statusLabel(dataStatus)}
        </span>
      }
    >
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-sm text-sub">내 총자산 {acct && <span className="ml-1 text-xs">· 시즌 {acct.season}</span>}</p>
          <Link to="/orders" className="flex items-center text-xs font-medium text-sub">
            주문내역{acct?.openOrders ? <span className="ml-1 rounded-full bg-brand px-1.5 text-white">{acct.openOrders}</span> : null}
            <ChevronIcon width={14} height={14} />
          </Link>
        </div>
        <p className="mt-1 text-[28px] font-bold">{pf ? formatMoney(pf.totalKrw, 'KRW') : '…'}</p>
        {pf && (
          <div className="mt-1 space-y-0.5 text-sm">
            {pf.dayPnlKrw !== undefined && (
              <p className={`font-medium ${changeColor(pf.dayPnlKrw)}`}>
                <span className="mr-1.5 font-normal text-sub">오늘</span>
                {formatSigned(pf.dayPnlKrw, 'KRW')}원 ({formatRate(pf.dayReturnRate ?? 0)})
              </p>
            )}
            <p className={`font-medium ${changeColor(pf.totalPnlKrw)}`}>
              <span className="mr-1.5 font-normal text-sub">시작 대비</span>
              {formatSigned(pf.totalPnlKrw, 'KRW')}원 ({formatRate(pf.totalReturnRate)})
            </p>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Link to="/fx" className="rounded-xl bg-soft px-3 py-2.5">
            <p className="text-sub">원화 주문가능</p>
            <p className="font-semibold">{acct ? formatMoney(acct.available.KRW, 'KRW') : '…'}</p>
          </Link>
          <Link to="/fx" className="rounded-xl bg-soft px-3 py-2.5">
            <p className="text-sub">달러 주문가능</p>
            <p className="font-semibold">{acct ? formatMoney(acct.available.USD, 'USD') : '…'}</p>
            {pf?.fxPnlKrw !== undefined && (
              <p className={`text-xs ${changeColor(pf.fxPnlKrw)}`}>환율 {formatSigned(pf.fxPnlKrw, 'KRW')}원</p>
            )}
          </Link>
        </div>
      </Card>

      <Card className={acct?.positions.length ? 'py-3' : ''}>
        <SectionTitle right={pf && pf.stockValueKrw > 0 ? <span className="text-sm text-sub">{formatMoney(pf.stockValueKrw, 'KRW')}</span> : null}>
          보유 주식
        </SectionTitle>
        {acct && acct.positions.length > 0 ? (
          acct.positions.map((p) => <HoldingRow key={p.code} position={p} stock={acct.stocks[p.code]} />)
        ) : (
          <Empty
            title="아직 보유한 주식이 없어요"
            desc="1,000만원으로 첫 투자를 시작해보세요"
            action={
              <Link to="/discover" className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white">
                종목 둘러보기
              </Link>
            }
          />
        )}
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
    </Page>
  );
}
