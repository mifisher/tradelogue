export interface Execution {
  execId: string;
  accountId: string;
  conid: number;
  underlying: string;
  description: string;
  assetCategory: 'OPT' | 'STK';
  expiry: string | null; // YYYY-MM-DD
  strike: number | null;
  putCall: 'P' | 'C' | null;
  multiplier: number;
  dateTime: Date; // UTC instant
  quantity: number; // signed: + buy, - sell
  price: number; // per-contract price (no multiplier)
  proceeds: number; // signed cash incl. multiplier; negative = buy
  commission: number; // negative
  raw: Record<string, unknown>;
}

export interface Trade {
  conid: number;
  underlying: string;
  description: string;
  expiry: string | null;
  strike: number | null;
  putCall: 'P' | 'C' | null;
  direction: 'long' | 'short';
  status: 'open' | 'closed';
  openedAt: Date;
  closedAt: Date | null;
  quantityOpened: number; // total contracts entered over the round trip
  avgEntryPrice: number;
  avgExitPrice: number | null;
  realizedPnl: number | null; // null while open
  commissions: number;
  executionIds: string[];
}
