export interface KrakenFuturesResponse {
  result: string;
  accounts?: {
    flex?: FlexAccount;
    cash?: { balances?: Record<string, number> };
  };
  elements?: PositionElement[];
  logs?: AccountLog[];
}

export interface FlexAccount {
  currencies: Record<string, { quantity: number; value: number; collateral: number; available: number }>;
  portfolioValue: number;
  availableMargin: number;
  initialMargin: number;
  pnl: number;
  unrealizedFunding: number;
}

export interface PositionElement {
  timestamp: number;
  event?: {
    PositionUpdate?: PositionUpdate;
  };
}

export interface PositionUpdate {
  tradeable: string;
  oldAverageEntryPrice: string;
  executionPrice: string;
  executionSize: string;
  realizedPnL: string;
  fee: string;
  feeCurrency: string;
  fillTime?: number;
  oldPosition: string;
  executionUid: string;
}

export interface AccountLog {
  info: string;
  date: string;
  contract: string;
  asset: string;
  fee: number;
  realized_pnl: number;
  realized_funding?: number;
  new_balance: number;
  old_balance: number;
}

export interface SpotTrade {
  pair: string;
  type: "buy" | "sell";
  price: string;
  vol: string;
  cost: string;
  fee: string;
  margin: string;
  time: number;
  misc: string;
  postxid: string;
  posstatus: string;
  leverage?: string;
  txid?: string;
}

export interface SpotLedgerEntry {
  refid: string;
  time: number;
  type: string;
  subtype?: string;
  asset: string;
  amount: string;
  fee: string;
  balance: string;
}
