import { priceLimits } from '@stock/core';
import type { CandleInterval, OrderSide } from '@stock/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Chart } from '../components/Chart';
import { AlertSheet } from '../components/AlertSheet';
import { BackIcon, BellIcon, StarIcon } from '../components/Icons';
import { Empty } from '../components/Layout';
import { MyStock } from '../components/MyStock';
import { OrderBook } from '../components/OrderBook';
import { OrderSheet } from '../components/OrderSheet';
import { StockLogo } from '../components/StockRow';
import { api } from '../lib/api';
import { changeColor, formatCompact, formatPrice, formatRate, formatSigned } from '../lib/format';
import { useLiveQuote } from '../lib/live';
import { useTheme } from '../lib/theme';
import { useAsync } from '../lib/useAsync';
import { useWatchlist } from '../lib/watchlist';

const INTERVALS: { value: CandleInterval; label: string }[] = [
  { value: '1m', label: '1분' },
  { value: '5m', label: '5분' },
  { value: '15m', label: '15분' },
  { value: '60m', label: '1시간' },
  { value: '1d', label: '일' },
  { value: '1w', label: '주' },
  { value: '1M', label: '월' },
];

export function StockDetail() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const { dark } = useTheme();
  const watch = useWatchlist();
  const [interval, setInterval] = useState<CandleInterval>('1d');
  const [orderSide, setOrderSide] = useState<OrderSide | null>(null);
  const [pickGroup, setPickGroup] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);

  const { data, error } = useAsync(() => api.stock(code), [code]);
  const quote = useLiveQuote(data?.stock.code, data?.quote);

  if (error) return <Empty title="종목을 불러오지 못했어요" desc={error.message} />;
  if (!data || !quote) return <div className="p-8 text-center text-sub">불러오는 중…</div>;

  const { stock } = data;
  const ccy = stock.currency;
  const limits = priceLimits(stock.market, quote.prevClose);

  const fmt = (v: number | undefined) => (v === undefined ? '-' : formatPrice(v, ccy));
  const info: [string, string][] = [
    ['시가', fmt(quote.open)],
    ['고가', fmt(quote.high)],
    ['저가', fmt(quote.low)],
    ['전일 종가', formatPrice(quote.prevClose, ccy)],
    ['거래량', formatCompact(quote.volume)],
    ...(limits
      ? ([
          ['상한가', formatPrice(limits.upper, ccy)],
          ['하한가', formatPrice(limits.lower, ccy)],
        ] as [string, string][])
      : []),
  ];

  return (
    <div className="mx-auto min-h-dvh max-w-[480px] pb-28">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-bg/95 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+10px)] backdrop-blur">
        <button onClick={() => navigate(-1)} className="p-2" aria-label="뒤로">
          <BackIcon />
        </button>
        <div className="flex-1" />
        <button onClick={() => setAlertOpen(true)} className="p-2 text-sub" aria-label="가격 알림">
          <BellIcon />
        </button>
        <button
          onClick={() => {
            // 그룹이 여러 개면 그룹별로 담기/빼기, 하나면 바로 토글
            if (watch.groups.length > 1) setPickGroup(true);
            else if (watch.has(stock.code)) void watch.removeAll(stock.code);
            else if (watch.groups[0]) void watch.add(watch.groups[0].id, stock.code);
          }}
          className={`p-2 ${watch.has(stock.code) ? 'text-[#ffb800]' : 'text-sub'}`}
          aria-label="관심 종목"
        >
          <StarIcon filled={watch.has(stock.code)} />
        </button>
      </header>

      <main className="space-y-3 px-4">
        <section className="px-1">
          <div className="flex items-center gap-2">
            <StockLogo stock={stock} size={28} />
            <p className="font-semibold">{stock.nameKo}</p>
            <p className="text-sm text-sub">
              {stock.code} · {stock.exchange}
            </p>
          </div>
          <p className="mt-2 text-[30px] font-bold">{stock.currency === 'KRW' ? `${formatPrice(quote.price, ccy)}원` : formatPrice(quote.price, ccy)}</p>
          <p className={`text-sm font-medium ${changeColor(quote.change)}`}>
            어제보다 {formatSigned(quote.change, ccy)} ({formatRate(quote.changeRate)})
            {quote.delayMinutes ? <span className="ml-1.5 text-xs font-normal text-sub">· {quote.delayMinutes}분 지연 시세</span> : null}
          </p>
        </section>

        <section className="rounded-2xl bg-card py-3">
          <Chart code={stock.code} currency={ccy} interval={interval} quote={quote} dark={dark} />
          <div className="no-scrollbar mt-2 flex gap-1 overflow-x-auto px-3">
            {INTERVALS.map((i) => (
              <button
                key={i.value}
                onClick={() => setInterval(i.value)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${interval === i.value ? 'bg-soft text-ink' : 'text-sub'}`}
              >
                {i.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-card p-5">
          <h2 className="mb-3 text-[17px] font-bold">시세 정보</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {info.map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-sub">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 호가: 한투 키가 있어 서버가 호가를 줄 때만 보임 */}
        <OrderBook code={stock.code} currency={ccy} prevClose={quote.prevClose} price={quote.price} />

        <MyStock stock={stock} quote={quote} />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 bg-bg/95 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-[480px] gap-2 px-4">
          <button onClick={() => setOrderSide('sell')} className="flex-1 rounded-2xl bg-down py-4 font-bold text-white">
            판매하기
          </button>
          <button onClick={() => setOrderSide('buy')} className="flex-1 rounded-2xl bg-up py-4 font-bold text-white">
            구매하기
          </button>
        </div>
      </div>

      {orderSide && <OrderSheet stock={stock} quote={quote} initialSide={orderSide} onClose={() => setOrderSide(null)} />}
      {alertOpen && <AlertSheet stock={stock} quote={quote} onClose={() => setAlertOpen(false)} />}

      {pickGroup && (
        <div className="fixed inset-0 z-30 flex items-end bg-black/40" onClick={() => setPickGroup(false)}>
          <div className="mx-auto w-full max-w-[480px] rounded-t-3xl bg-card px-5 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-lg font-bold">관심 그룹</h2>
            {watch.groups.map((g) => {
              const inGroup = g.codes.includes(stock.code);
              return (
                <button
                  key={g.id}
                  onClick={() => void (inGroup ? watch.remove(g.id, stock.code) : watch.add(g.id, stock.code))}
                  className="flex w-full items-center justify-between border-b border-line py-3.5 text-left last:border-0"
                >
                  <span className="font-semibold">
                    {g.name} <span className="text-sm font-normal text-sub">{g.codes.length}종목</span>
                  </span>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${inGroup ? 'bg-brand text-white' : 'bg-soft text-transparent'}`}>✓</span>
                </button>
              );
            })}
            <button onClick={() => setPickGroup(false)} className="mt-3 w-full rounded-xl bg-soft py-3 font-semibold">
              완료
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
