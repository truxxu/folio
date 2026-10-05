export type Currency = "usd" | "cop";

// Currencies a cash or account holding can be held in. Separate from the display currency.
export type Fiat = "usd" | "eur" | "cop";
export const FIATS: Fiat[] = ["usd", "eur", "cop"];

export type HoldingKind = "crypto" | "stock" | "cash" | "account";

export interface Holding {
  // crypto: CoinGecko id, e.g. "bitcoin"; stock: "stock:<TICKER>"; cash: "cash:<fiat>"; account: "account:<uuid>"
  id: string;
  symbol: string; // e.g. "BTC", the ticker for stocks, or the currency code for cash/accounts
  name: string; // e.g. "Bitcoin", "Euros", "Bancolombia savings"
  amount: number;
  kind?: HoldingKind; // missing means "crypto" (data saved before cash/accounts existed)
  fiat?: Fiat; // only for cash and accounts
}

export const kindOf = (h: Holding): HoldingKind => h.kind ?? "crypto";

// Crypto is priced by CoinGecko, stocks by Finnhub (with the user's own key), cash and accounts by the fiat rates.
export const isMarket = (h: Holding): boolean => kindOf(h) === "crypto";
export const isStock = (h: Holding): boolean => kindOf(h) === "stock";
export const isFiat = (h: Holding): boolean => kindOf(h) === "cash" || kindOf(h) === "account";
export const stockId = (ticker: string) => `stock:${ticker}`;

export interface AppState {
  version: 1;
  holdings: Holding[];
  currency: Currency;
  hideBalances?: boolean; // mask money values when the app opens; missing in data saved before it existed
  finnhubKey?: string; // the user's own Finnhub API key for stock prices; never exported in backups
}

// Keyed by CoinGecko id for crypto and by holding id ("stock:AAPL") for stocks.
// { bitcoin: { usd: 64000, usd_24h_change: 1.2, cop: ..., cop_24h_change: ... } }
export type PriceMap = Record<string, Record<string, number | undefined>>;

// Units of each currency per 1 USD (usd is always 1). Missing when the rate couldn't be fetched.
export type Rates = Partial<Record<Fiat, number>>;

export interface PriceCache {
  data: PriceMap;
  rates?: Rates; // absent in caches saved before cash/accounts existed
  fetchedAt: number;
}

export interface CoinSearchResult {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number | null;
}

export interface StockSearchResult {
  symbol: string; // e.g. "AAPL"
  description: string; // e.g. "APPLE INC"
  type: string; // e.g. "Common Stock", "ETP"
}
