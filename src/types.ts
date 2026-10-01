export type Currency = "usd" | "cop";

export interface Holding {
  id: string; // CoinGecko id, e.g. "bitcoin"
  symbol: string; // e.g. "BTC"
  name: string; // e.g. "Bitcoin"
  amount: number;
}

export interface AppState {
  version: 1;
  holdings: Holding[];
  currency: Currency;
}

// { bitcoin: { usd: 64000, usd_24h_change: 1.2, cop: ..., cop_24h_change: ... } }
export type PriceMap = Record<string, Record<string, number | undefined>>;

export interface PriceCache {
  data: PriceMap;
  fetchedAt: number;
}

export interface CoinSearchResult {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number | null;
}
