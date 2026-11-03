import { describe, expect, it } from 'vitest';
import { searchStocks, toChosung } from '../src';
import { APPLE, HYNIX, SAMSUNG } from './fixtures';

const stocks = [SAMSUNG, HYNIX, APPLE];
const codes = (q: string) => searchStocks(stocks, q).map((s) => s.code);

describe('검색', () => {
  it('초성 변환', () => {
    expect(toChosung('삼성전자')).toBe('ㅅㅅㅈㅈ');
    expect(toChosung('SK하이닉스')).toBe('SKㅎㅇㄴㅅ');
  });

  it('한글명·코드·영문·별칭', () => {
    expect(codes('삼성')).toEqual(['005930']);
    expect(codes('005930')).toEqual(['005930']);
    expect(codes('aapl')).toEqual(['AAPL']);
    expect(codes('apple')).toEqual(['AAPL']);
    expect(codes('애플')).toEqual(['AAPL']);
    expect(codes('하이닉스')).toEqual(['000660']);
  });

  it('초성 검색', () => {
    expect(codes('ㅅㅅㅈㅈ')).toEqual(['005930']);
    expect(codes('ㅎㅇㄴㅅ')).toEqual(['000660']);
  });

  it('빈 검색어는 결과 없음', () => {
    expect(codes('  ')).toEqual([]);
  });
});
