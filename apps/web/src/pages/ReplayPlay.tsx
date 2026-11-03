import {
  closeAt,
  createReplayAccount,
  replayDayTime,
  replayOrder,
  replayTimeline,
  trimReplayCandles,
  valueReplayAccount,
  visibleCandles,
  type ReplayAccount,
} from '@stock/core';
import type { Candle, OrderSide, ReplayScenario, StockInfo } from '@stock/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Card, Empty, SectionTitle, Segmented, SubPage } from '../components/Layout';
import { ReplayChart } from '../components/ReplayChart';
import { ReplayOrderSheet } from '../components/ReplayOrderSheet';
import { StockLogo } from '../components/StockRow';
import { changeColor, formatMoney, formatPrice, formatRate, formatSigned } from '../lib/format';
import { replayApi, replayDateText, scenarioRange } from '../lib/replay';
import { useStored } from '../lib/storage';
import { useTheme } from '../lib/theme';
import { toast } from '../lib/toast';

type Speed = '1' | '2' | '4';

interface Loaded {
  scenario: ReplayScenario;
  /** 일봉을 받아온 종목만 */
  codes: string[];
  stocks: Record<string, StockInfo>;
  histories: Record<string, Candle[]>;
  /** 재생할 날짜들 (epoch 초) */
  days: number[];
}

/** 시나리오 + 종목별 일봉 불러오기 (일봉 못 받은 종목은 빼고 진행) */
async function load(id: string): Promise<Loaded> {
  const { scenarios, stocks } = await replayApi.scenarios();
  const scenario = scenarios.find((s) => s.id === id);
  if (!scenario) throw new Error('없는 시나리오예요');
  const { from, to } = scenarioRange(scenario);
  const start = replayDayTime(scenario.start);
  const end = replayDayTime(scenario.end);
  const got = await Promise.allSettled(scenario.codes.map((c) => replayApi.history(c, from, to)));
  const histories: Record<string, Candle[]> = {};
  got.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const cs = trimReplayCandles(r.value.candles, start, end, scenario.lookbackDays);
    if (cs.some((c) => c.time >= start)) histories[scenario.codes[i]!] = cs;
  });
  const codes = scenario.codes.filter((c) => histories[c]);
  const days = replayTimeline(Object.values(histories), start, end);
  if (days.length === 0) {
    const reason = got.find((r): r is PromiseRejectedResult => r.status === 'rejected')?.reason as Error | undefined;
    throw new Error(reason?.message ?? '이 기간 시세가 없어요');
  }
  return { scenario, codes, stocks, histories, days };
}

export function ReplayPlay() {
  const { id = '' } = useParams();
  const [data, setData] = useState<Loaded>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let alive = true;
    setData(undefined);
    setError(undefined);
    load(id).then(
      (d) => alive && setData(d),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <SubPage title="타임머신 리플레이"><Empty title="리플레이를 시작하지 못했어요" desc={error} /></SubPage>;
  if (!data) return <SubPage title="타임머신 리플레이"><p className="p-8 text-center text-sub">과거 시세를 불러오는 중…</p></SubPage>;
  return <Player key={id} data={data} />;
}

function Player({ data }: { data: Loaded }) {
  const { scenario, codes, stocks, histories, days } = data;
  const navigate = useNavigate();
  const { dark } = useTheme();
  const ccy = scenario.currency;
  const last = days.length - 1;

  const [round, setRound] = useState(0);
  const [dayIdx, setDayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useStored<Speed>('replay.speed', '1');
  const [account, setAccount] = useState<ReplayAccount>(() => createReplayAccount(scenario.market, scenario.startCash));
  const [code, setCode] = useState(codes[0]!);
  const [sheet, setSheet] = useState<OrderSide | null>(null);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>();
  const savedRound = useRef(-1);

  const time = days[dayIdx]!;
  const finished = dayIdx >= last;
  const stock = stocks[code];
  const value = valueReplayAccount(account, histories, time);
  const visible = useMemo(() => visibleCandles(histories[code] ?? [], time), [histories, code, time]);
  const close = visible[visible.length - 1]?.close;
  const prevClose = visible[visible.length - 2]?.close;
  const myTrades = useMemo(() => account.trades.filter((t) => t.code === code), [account.trades, code]);

  // 재생: 1x = 하루 1초
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setDayIdx((i) => Math.min(i + 1, last)), 1000 / Number(speed));
    return () => window.clearInterval(timer);
  }, [playing, speed, last]);

  useEffect(() => {
    if (finished) setPlaying(false);
  }, [finished]);

  // 마지막 날에 닿으면 결과 저장 (한 판에 한 번)
  useEffect(() => {
    if (!finished || savedRound.current === round) return;
    savedRound.current = round;
    setSaveState('saving');
    replayApi
      .saveResult({
        scenarioId: scenario.id,
        codes,
        finalValue: value.total,
        returnRate: value.returnRate,
        tradeCount: account.trades.length,
        finishedAt: Date.now(),
      })
      .then(
        () => setSaveState('saved'),
        (e: Error) => {
          setSaveState('error');
          toast(`결과를 저장하지 못했어요: ${e.message}`, 'error');
        },
      );
  }, [finished, round]);

  const restart = () => {
    setPlaying(false);
    setDayIdx(0);
    setAccount(createReplayAccount(scenario.market, scenario.startCash));
    setSaveState(undefined);
    setRound((r) => r + 1);
    window.scrollTo(0, 0);
  };

  const openSheet = (side: OrderSide) => {
    setPlaying(false);
    setSheet(side);
  };

  const submit = (side: OrderSide, qty: number): string | undefined => {
    const r = replayOrder(account, { code, side, qty, candles: histories[code] ?? [], time });
    if (!r.ok) return r.message;
    setAccount(r.account);
    setSheet(null);
    toast(`${stock?.nameKo ?? code} ${qty.toLocaleString()}주 ${side === 'buy' ? '구매' : '판매'} · ${formatPrice(r.trade.price, ccy)}`);
    return undefined;
  };

  const holdings = Object.values(account.positions);

  return (
    <SubPage title={scenario.title}>
      {/* 날짜·재생 */}
      <Card className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-sub">지금 날짜</p>
            <p className="text-lg font-bold" data-testid="replay-date">
              {replayDateText(time)}
            </p>
          </div>
          <p className="text-xs text-sub">
            {dayIdx + 1} / {days.length}일
          </p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-soft">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${((dayIdx + 1) / days.length) * 100}%` }} />
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={finished}
            onClick={() => setPlaying(!playing)}
            className="w-24 rounded-xl bg-brand py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {playing ? '❚❚ 멈춤' : '▶ 재생'}
          </button>
          <button
            disabled={finished}
            onClick={() => setDayIdx((i) => Math.min(i + 1, last))}
            className="rounded-xl bg-soft px-3 py-2.5 text-sm font-semibold disabled:opacity-40"
          >
            +1일
          </button>
          <div className="flex-1">
            <Segmented<Speed>
              size="sm"
              options={[
                { value: '1', label: '1x' },
                { value: '2', label: '2x' },
                { value: '4', label: '4x' },
              ]}
              value={speed}
              onChange={setSpeed}
            />
          </div>
        </div>
      </Card>

      {/* 자산 */}
      <Card>
        <p className="text-sm text-sub">총 자산</p>
        <p className="text-[26px] font-bold" data-testid="replay-total">
          {formatMoney(value.total, ccy)}
        </p>
        <p className={`text-sm font-medium ${changeColor(value.returnRate)}`}>
          시작보다 {formatSigned(value.total - account.startCash, ccy)} ({formatRate(value.returnRate)})
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-soft px-3 py-2">
            <p className="text-xs text-sub">현금</p>
            <p className="font-semibold">{formatMoney(account.cash, ccy)}</p>
          </div>
          <div className="rounded-xl bg-soft px-3 py-2">
            <p className="text-xs text-sub">주식</p>
            <p className="font-semibold">{formatMoney(value.stockValue, ccy)}</p>
          </div>
        </div>
      </Card>

      {finished && <ResultCard data={data} account={account} total={value.total} rate={value.returnRate} saveState={saveState} onRestart={restart} onList={() => navigate('/replay')} />}

      {/* 종목 탭 */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
        {codes.map((c) => {
          const vs = visibleCandles(histories[c] ?? [], time);
          const now = vs[vs.length - 1]?.close;
          const prev = vs[vs.length - 2]?.close;
          const rate = now !== undefined && prev ? (now - prev) / prev : 0;
          return (
            <button
              key={c}
              onClick={() => setCode(c)}
              className={`shrink-0 rounded-xl px-3 py-2 text-left ${c === code ? 'bg-ink text-bg' : 'bg-card'}`}
            >
              <p className="text-[13px] font-semibold">{stocks[c]?.nameKo ?? c}</p>
              <p className={`text-xs font-medium ${c === code ? '' : changeColor(rate)}`}>{formatRate(rate)}</p>
            </button>
          );
        })}
      </div>

      {/* 차트 */}
      <section className="rounded-2xl bg-card pb-3 pt-4">
        <div className="mb-2 flex items-center gap-2 px-5">
          {stock && <StockLogo stock={stock} size={28} />}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{stock?.nameKo ?? code}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold" data-testid="replay-price">
              {close !== undefined ? formatPrice(close, ccy) : '-'}
              {ccy === 'KRW' && close !== undefined ? '원' : ''}
            </p>
            {close !== undefined && prevClose !== undefined && (
              <p className={`text-xs font-medium ${changeColor(close - prevClose)}`}>
                어제보다 {formatSigned(close - prevClose, ccy)} ({formatRate((close - prevClose) / prevClose)})
              </p>
            )}
          </div>
        </div>
        <ReplayChart candles={visible} currency={ccy} dark={dark} trades={myTrades} resetKey={`${round}:${code}`} />
      </section>

      {/* 보유 종목 */}
      <Card>
        <SectionTitle>보유 종목</SectionTitle>
        {holdings.length === 0 ? (
          <p className="py-2 text-center text-sm text-sub">아직 산 종목이 없어요</p>
        ) : (
          <ul className="space-y-1">
            {holdings.map((p) => {
              const price = closeAt(histories[p.code] ?? [], time) ?? p.avgPrice;
              const pnl = (price - p.avgPrice) * p.qty;
              const rate = p.avgPrice > 0 ? (price - p.avgPrice) / p.avgPrice : 0;
              return (
                <li key={p.code}>
                  <button onClick={() => setCode(p.code)} className="flex w-full items-center gap-3 rounded-xl py-2 text-left active:bg-soft">
                    {stocks[p.code] ? <StockLogo stock={stocks[p.code]!} size={36} /> : <div className="h-9 w-9 rounded-full bg-soft" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{stocks[p.code]?.nameKo ?? p.code}</p>
                      <p className="text-[13px] text-sub">
                        {p.qty.toLocaleString()}주 · 평균 {formatPrice(p.avgPrice, ccy)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatMoney(price * p.qty, ccy)}</p>
                      <p className={`text-[13px] font-medium ${changeColor(pnl)}`}>
                        {formatSigned(pnl, ccy)} ({formatRate(rate)})
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {account.trades.length > 0 && (
        <Card>
          <SectionTitle>거래 기록</SectionTitle>
          <ul className="space-y-2 text-sm">
            {[...account.trades].reverse().slice(0, 20).map((t, i) => (
              <li key={i} className="flex justify-between">
                <span>
                  <span className="text-sub">{replayDateText(t.time, false)}</span> {stocks[t.code]?.nameKo ?? t.code}
                </span>
                <span className={t.side === 'buy' ? 'text-up' : 'text-down'}>
                  {t.side === 'buy' ? '구매' : '판매'} {t.qty.toLocaleString()}주 · {formatPrice(t.price, ccy)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="h-20" />

      {!finished && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-bg/95 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur">
          <div className="mx-auto flex max-w-[480px] gap-2 px-4">
            <button disabled={close === undefined} onClick={() => openSheet('sell')} className="flex-1 rounded-2xl bg-down py-4 font-bold text-white disabled:opacity-40">
              판매하기
            </button>
            <button disabled={close === undefined} onClick={() => openSheet('buy')} className="flex-1 rounded-2xl bg-up py-4 font-bold text-white disabled:opacity-40">
              구매하기
            </button>
          </div>
        </div>
      )}

      {sheet && stock && close !== undefined && (
        <ReplayOrderSheet
          stock={stock}
          account={account}
          close={close}
          dateText={replayDateText(time, false)}
          initialSide={sheet}
          onSubmit={submit}
          onClose={() => setSheet(null)}
        />
      )}
    </SubPage>
  );
}

function ResultCard(p: {
  data: Loaded;
  account: ReplayAccount;
  total: number;
  rate: number;
  saveState?: 'saving' | 'saved' | 'error';
  onRestart: () => void;
  onList: () => void;
}) {
  const { scenario, codes, stocks, histories, days } = p.data;
  const ccy = scenario.currency;
  const first = days[0]!;
  const end = days[days.length - 1]!;
  // 같은 기간 그냥 들고만 있었다면 (종목별 등락)
  const holds = codes.flatMap((c) => {
    const a = closeAt(histories[c] ?? [], first);
    const b = closeAt(histories[c] ?? [], end);
    return a && b ? [{ code: c, rate: (b - a) / a }] : [];
  });
  const realized = p.account.trades.reduce((s, t) => s + t.realizedPnl, 0);

  return (
    <Card className="space-y-3 border-2 border-brand/40">
      <div>
        <p className="text-sm font-semibold text-brand">리플레이 끝!</p>
        <p className={`text-[30px] font-bold ${changeColor(p.rate)}`} data-testid="replay-result-rate">
          {formatRate(p.rate)}
        </p>
        <p className="text-sm text-sub">
          {formatMoney(scenario.startCash, ccy)} → <span className="font-semibold text-ink">{formatMoney(p.total, ccy)}</span>
        </p>
        <p className="text-xs text-sub">
          거래 {p.account.trades.length}회 · 실현손익 {formatSigned(realized, ccy)}
        </p>
      </div>
      {holds.length > 0 && (
        <div className="rounded-xl bg-soft px-4 py-3 text-sm">
          <p className="mb-1.5 text-xs text-sub">같은 기간 그냥 들고만 있었다면</p>
          {holds.map((h) => (
            <div key={h.code} className="flex justify-between">
              <span>{stocks[h.code]?.nameKo ?? h.code}</span>
              <span className={`font-medium ${changeColor(h.rate)}`}>{formatRate(h.rate)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-sub" data-testid="replay-save-state">
        {p.saveState === 'saving' ? '기록 저장 중…' : p.saveState === 'saved' ? '기록에 저장했어요' : p.saveState === 'error' ? '기록을 저장하지 못했어요' : ''}
      </p>
      <div className="flex gap-2">
        <button onClick={p.onList} className="flex-1 rounded-xl bg-soft py-3 font-semibold">
          다른 시나리오
        </button>
        <button onClick={p.onRestart} className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white">
          다시 하기
        </button>
      </div>
    </Card>
  );
}
