export type Currency = "usd" | "cop";

// Currencies a cash or account holding can be held in. Separate from the display currency.
export type Fiat = "usd" | "eur" | "cop";
export const FIATS: Fiat[] = ["usd", "eur", "cop"];

export type HoldingKind = "crypto" | "stock" | "cash" | "account";

export interface Holding {
  // crypto: CoinGecko id, e.g. "bitcoin"; stock: CoinGecko id of a tokenized stock; cash: "cash:<fiat>"; account: "account:<uuid>"
  id: string;
  symbol: string; // e.g. "BTC", or the currency code for cash/accounts
  name: string; // e.g. "Bitcoin", "Euros", "Bancolombia savings"
  amount: number;
  kind?: HoldingKind; // missing means "crypto" (data saved before cash/accounts existed)
  fiat?: Fiat; // only for cash and accounts
}

export const kindOf = (h: Holding): HoldingKind => h.kind ?? "crypto";

// Crypto and stocks are priced by CoinGecko; cash and accounts by the fiat rates.
export const isMarket = (h: Holding): boolean => kindOf(h) === "crypto" || kindOf(h) === "stock";

export interface AppState {
  version: 1;
  holdings: Holding[];
  currency: Currency;
  hideBalances?: boolean; // mask money values when the app opens; missing in data saved before it existed
}

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
