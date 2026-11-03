import type { StockInfo } from '@stock/shared';

// 가짜 시세용 종목 목록. 기준가는 그럴듯한 값일 뿐 실제 시세 아님.
type MockStock = StockInfo & { basePrice: number; volatility: number };

const kr = (code: string, exchange: 'KOSPI' | 'KOSDAQ', nameKo: string, nameEn: string, basePrice: number, volatility = 0.02): MockStock => ({
  code, market: 'KR', exchange, nameKo, nameEn, currency: 'KRW', basePrice, volatility,
});
const us = (code: string, exchange: 'NASDAQ' | 'NYSE', nameKo: string, nameEn: string, basePrice: number, volatility = 0.018): MockStock => ({
  code, market: 'US', exchange, nameKo, nameEn, currency: 'USD', aliases: [nameKo], basePrice, volatility,
});

export const MOCK_STOCKS: MockStock[] = [
  kr('005930', 'KOSPI', '삼성전자', 'Samsung Electronics', 72_000),
  kr('000660', 'KOSPI', 'SK하이닉스', 'SK hynix', 215_000, 0.028),
  kr('373220', 'KOSPI', 'LG에너지솔루션', 'LG Energy Solution', 380_000, 0.025),
  kr('207940', 'KOSPI', '삼성바이오로직스', 'Samsung Biologics', 980_000),
  kr('005380', 'KOSPI', '현대차', 'Hyundai Motor', 235_000),
  kr('000270', 'KOSPI', '기아', 'Kia', 98_000),
  kr('068270', 'KOSPI', '셀트리온', 'Celltrion', 182_000),
  kr('035420', 'KOSPI', 'NAVER', 'NAVER', 205_000),
  kr('035720', 'KOSPI', '카카오', 'Kakao', 41_500, 0.025),
  kr('105560', 'KOSPI', 'KB금융', 'KB Financial Group', 96_000, 0.015),
  kr('005490', 'KOSPI', 'POSCO홀딩스', 'POSCO Holdings', 310_000),
  kr('012450', 'KOSPI', '한화에어로스페이스', 'Hanwha Aerospace', 720_000, 0.03),
  kr('247540', 'KOSDAQ', '에코프로비엠', 'EcoPro BM', 118_000, 0.035),
  kr('196170', 'KOSDAQ', '알테오젠', 'Alteogen', 365_000, 0.035),
  kr('028300', 'KOSDAQ', 'HLB', 'HLB', 58_000, 0.04),
  kr('263750', 'KOSDAQ', '펄어비스', 'Pearl Abyss', 31_000, 0.03),
  us('AAPL', 'NASDAQ', '애플', 'Apple Inc.', 228),
  us('MSFT', 'NASDAQ', '마이크로소프트', 'Microsoft', 425),
  us('NVDA', 'NASDAQ', '엔비디아', 'NVIDIA', 142, 0.03),
  us('TSLA', 'NASDAQ', '테슬라', 'Tesla', 255, 0.035),
  us('AMZN', 'NASDAQ', '아마존', 'Amazon.com', 198),
  us('GOOGL', 'NASDAQ', '알파벳', 'Alphabet Class A', 172),
  us('META', 'NASDAQ', '메타', 'Meta Platforms', 585),
  us('NFLX', 'NASDAQ', '넷플릭스', 'Netflix', 760),
  us('AMD', 'NASDAQ', 'AMD', 'Advanced Micro Devices', 155, 0.03),
  us('PLTR', 'NASDAQ', '팔란티어', 'Palantir Technologies', 42, 0.04),
  us('KO', 'NYSE', '코카콜라', 'Coca-Cola', 68, 0.01),
  us('JPM', 'NYSE', 'JP모건', 'JPMorgan Chase', 225, 0.015),
  us('SOUN', 'NASDAQ', '사운드하운드', 'SoundHound AI', 0.85, 0.05),
];
// 구글은 '구글'로도 찾을 수 있게
MOCK_STOCKS.find((s) => s.code === 'GOOGL')?.aliases?.push('구글');

export const MOCK_INDICES = [
  { symbol: '^KS11', name: '코스피', base: 2_650, volatility: 0.009 },
  { symbol: '^KQ11', name: '코스닥', base: 760, volatility: 0.012 },
  { symbol: '^IXIC', name: '나스닥', base: 18_500, volatility: 0.012 },
  { symbol: '^GSPC', name: 'S&P 500', base: 5_800, volatility: 0.009 },
  { symbol: 'KRW=X', name: '원/달러', base: 1_385, volatility: 0.004 },
] as const;
