export type Currency = "usd" | "cop";

// Currencies a cash or account holding can be held in. Separate from the display currency.
export type Fiat = "usd" | "eur" | "cop";
export const FIATS: Fiat[] = ["usd", "eur", "cop"];

export type HoldingKind = "crypto" | "cash" | "account";

export interface Holding {
  // crypto: CoinGecko id, e.g. "bitcoin"; cash: "cash:<fiat>"; account: "account:<uuid>"
  id: string;
  symbol: string; // e.g. "BTC", or the currency code for cash/accounts
  name: string; // e.g. "Bitcoin", "Euros", "Bancolombia savings"
  amount: number;
  kind?: HoldingKind; // missing means "crypto" (data saved before cash/accounts existed)
  fiat?: Fiat; // only for cash and accounts
}

export const kindOf = (h: Holding): HoldingKind => h.kind ?? "crypto";

export interface AppState {
  version: 1;
  holdings: Holding[];
  currency: Currency;
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
