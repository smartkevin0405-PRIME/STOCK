import type { AccountState } from '@stock/core';

// M0 임시 계좌. M2에서 서버 계좌(주문·체결·잔고)로 교체
export const SEED_KRW = 10_000_000;

export const DEMO_ACCOUNT: AccountState = {
  cash: { KRW: SEED_KRW, USD: 0 },
  positions: {},
};
