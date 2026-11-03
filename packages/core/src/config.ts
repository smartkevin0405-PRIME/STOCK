// 수수료·세금 등 매매 규칙 숫자는 전부 여기서 관리 (세법·수수료 바뀌면 여기만 수정)

export interface TradingConfig {
  /** 국내 매매 수수료율 (매수·매도 각각) */
  krCommissionRate: number;
  /** 해외 매매 수수료율 (매수·매도 각각) */
  usCommissionRate: number;
  /** 국내 매도 시 증권거래세 (농특세 포함) */
  krSellTaxRate: number;
  /** 미국 매도 시 SEC 수수료 등 */
  usSellFeeRate: number;
  /** 시장가 주문 슬리피지 (호가 정보가 없을 때만 적용) */
  slippageRate: number;
  /** 환전 스프레드 (기준환율 대비) */
  fxSpreadRate: number;
  /** 국내 가격제한폭 */
  krPriceLimitRate: number;
}

export const DEFAULT_CONFIG: TradingConfig = {
  krCommissionRate: 0.00015,
  usCommissionRate: 0.0025,
  krSellTaxRate: 0.002, // 2026년 기준 코스피·코스닥 0.20%
  usSellFeeRate: 0,
  slippageRate: 0.0005,
  fxSpreadRate: 0.01,
  krPriceLimitRate: 0.3,
};
