import type { Order, Quote, StockInfo } from '@stock/shared';

export const SAMSUNG: StockInfo = {
  code: '005930', market: 'KR', exchange: 'KOSPI', nameKo: '삼성전자', nameEn: 'Samsung Electronics', currency: 'KRW',
};
export const HYNIX: StockInfo = {
  code: '000660', market: 'KR', exchange: 'KOSPI', nameKo: 'SK하이닉스', nameEn: 'SK hynix', currency: 'KRW',
};
export const APPLE: StockInfo = {
  code: 'AAPL', market: 'US', exchange: 'NASDAQ', nameKo: '애플', nameEn: 'Apple Inc.', currency: 'USD', aliases: ['애플'],
};

export function quote(code: string, price: number, prevClose = price, extra: Partial<Quote> = {}): Quote {
  return {
    code, price, prevClose, open: prevClose, high: price, low: price, volume: 0,
    change: price - prevClose, changeRate: (price - prevClose) / prevClose, timestamp: 0, ...extra,
  };
}

export function order(partial: Partial<Order> & Pick<Order, 'side' | 'type' | 'qty'>): Order {
  return { id: 'o1', code: '005930', market: 'KR', status: 'pending', createdAt: 0, ...partial };
}
