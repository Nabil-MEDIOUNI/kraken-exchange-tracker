export interface CoinIcon {
  bg: string;
  letter: string;
}

export interface CurrencyAmount {
  amount: string;
  currency: { symbol: string };
  cost_basis?: string;
}

export type Side = "Long" | "Short";

export interface NormalizedPosition {
  id: string;
  positionOpened: string;
  positionClosed: string;
  side: Side;
  market: string;
  base: string;
  symbol: string;
  openingPrice: number;
  closingPrice: number;
  quantity: number;
  pnl: number;
  pnlPct: number;
  currency: string;
  feeCurrency: string;
  leverage?: string;
}

export interface FuturesTransaction {
  type: string;
  date: string;
  contract?: string;
  currency: string;
  amount: number;
  fee?: number;
  realizedPnL?: number;
  tag?: string;
}

export interface SpotTransaction {
  id: string;
  type: string;
  date: string;
  description: string | null;
  label: string | null;
  txhash: string | null;
  from?: CurrencyAmount;
  to?: CurrencyAmount;
  fee?: CurrencyAmount & { amount: string };
  net_value: string;
  fee_value: string;
  gain: string;
}
