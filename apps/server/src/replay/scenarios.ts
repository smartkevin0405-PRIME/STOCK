import type { ReplayScenario } from '@stock/shared';

const KR_CASH = 10_000_000;
const US_CASH = 10_000;
const LOOKBACK = 60;
const US_BIG = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN'];

// 리플레이 시나리오. 종목은 그 시절에도 상장돼 있던 것만
export const REPLAY_SCENARIOS: readonly ReplayScenario[] = [
  {
    id: 'covid-2020-kr',
    title: '2020 코로나 폭락 · 국내',
    description: '3월에 코스피가 1,400대까지 빠졌다가 V자로 돌아왔어요. 공포 속에서 버틸 수 있을까요?',
    market: 'KR',
    currency: 'KRW',
    start: '2020-02-03',
    end: '2020-06-30',
    startCash: KR_CASH,
    codes: ['005930', '000660', '035420', '005380', '035720'],
    lookbackDays: LOOKBACK,
  },
  {
    id: 'covid-2020-us',
    title: '2020 코로나 폭락 · 미국',
    description: '한 달 만에 S&P500이 30% 넘게 빠지고, 서킷브레이커가 네 번 걸렸어요.',
    market: 'US',
    currency: 'USD',
    start: '2020-02-03',
    end: '2020-06-30',
    startCash: US_CASH,
    codes: US_BIG,
    lookbackDays: LOOKBACK,
  },
  {
    id: 'rate-hike-2022-us',
    title: '2022 금리인상장 · 미국',
    description: '연준이 금리를 빠르게 올리면서 기술주가 1년 내내 미끄러졌어요.',
    market: 'US',
    currency: 'USD',
    start: '2022-01-03',
    end: '2022-12-30',
    startCash: US_CASH,
    codes: US_BIG,
    lookbackDays: LOOKBACK,
  },
  {
    id: 'gfc-2008-kr',
    title: '2008 금융위기 · 국내',
    description: '리먼 브라더스 파산 뒤 코스피가 900선까지 내려앉았어요.',
    market: 'KR',
    currency: 'KRW',
    start: '2008-09-01',
    end: '2009-03-31',
    startCash: KR_CASH,
    codes: ['005930', '000660', '005380', '005490', '035420'],
    lookbackDays: LOOKBACK,
  },
  {
    id: 'donghak-2021-kr',
    title: '2021 동학개미 랠리 · 국내',
    description: '개인 투자자가 몰리며 코스피가 처음으로 3,000을 넘었어요.',
    market: 'KR',
    currency: 'KRW',
    start: '2020-11-02',
    end: '2021-06-30',
    startCash: KR_CASH,
    codes: ['005930', '000660', '035420', '035720', '005380'],
    lookbackDays: LOOKBACK,
  },
];

export function findScenario(id: string): ReplayScenario | undefined {
  return REPLAY_SCENARIOS.find((s) => s.id === id);
}
