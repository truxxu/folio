import { FIATS, stockId, type CoinSearchResult, type PriceMap, type Rates, type StockSearchResult } from "./types";

const BASE = "https://api.coingecko.com/api/v3";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("Can't reach the price service. Check your connection.");
  }
  if (res.status === 429) {
    throw new Error("The price service is rate-limiting requests. Try again in a minute.");
  }
  if (!res.ok) throw new Error(`The price service returned an error (${res.status}).`);
  return res.json() as Promise<T>;
}

// CoinGecko doesn't support COP, and cash can be held in EUR, so fiat rates come from yadio.io.
// Only the rates actually fetched are returned; `fetchPrices` fills the gaps from the last good ones.
async function fetchUsdRates(signal?: AbortSignal): Promise<Rates> {
  const rates: Rates = {};
  try {
    const res = await fetch("https://api.yadio.io/exrates/USD", { signal });
    if (!res.ok) return rates;
    const { USD } = (await res.json()) as { USD?: Record<string, unknown> };
    for (const f of FIATS) {
      const rate = USD?.[f.toUpperCase()];
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[f] = rate;
    }
  } catch {
    // none fetched
  }
  return rates;
}

// Always asked for alongside the user's own ids, so the request doesn't list exactly what they hold.
// This only blurs common holdings: a rare coin still stands out, and searches still reveal what was typed.
const DECOY_IDS = [
  "bitcoin",
  "ethereum",
  "tether",
  "solana",
  "ripple",
  "usd-coin",
  "dogecoin",
  "cardano",
  "tron",
  "binancecoin",
];

export interface StockRequest {
  tickers: string[];
  key: string;
}

// `fallback` is the last good set of rates, kept for any rate yadio doesn't return this time.
// A Finnhub failure doesn't fail the whole fetch: crypto prices still come back, with `stockError` set
// and no stock entries, so the caller can keep the last stock prices it had.
export async function fetchPrices(
  ids: string[],
  stocks: StockRequest | null,
  fallback?: Rates,
  signal?: AbortSignal,
): Promise<{ data: PriceMap; rates: Rates; stockError?: string }> {
  const params = new URLSearchParams({
    ids: [...new Set([...ids, ...DECOY_IDS])].sort().join(","),
    vs_currencies: "usd",
    include_24hr_change: "true",
  });
  let stockError: string | undefined;
  // A portfolio without crypto doesn't need CoinGecko (and its rate limit) at all.
  const [coins, stockData, fetched] = await Promise.all([
    ids.length ? get<PriceMap>(`/simple/price?${params}`, signal) : Promise.resolve({} as PriceMap),
    stocks?.tickers.length
      ? fetchStockQuotes(stocks.tickers, stocks.key, signal).catch((e: unknown) => {
          if (signal?.aborted) throw e;
          stockError = e instanceof Error ? e.message : "Couldn't update stock prices.";
          return {} as PriceMap;
        })
      : Promise.resolve({} as PriceMap),
    fetchUsdRates(signal),
  ]);
  const data = { ...coins, ...stockData };
  const rates: Rates = { ...fallback, ...fetched, usd: 1 };
  if (rates.cop !== undefined) withCop(data, rates.cop);
  return { data, rates, stockError };
}

// Adds COP prices derived from USD ones, in place.
export function withCop(data: PriceMap, cop: number): PriceMap {
  for (const p of Object.values(data)) {
    if (p.usd === undefined) continue;
    p.cop = p.usd * cop;
    // Approximation: ignores how the USD/COP rate itself moved over the last 24h.
    p.cop_24h_change = p.usd_24h_change;
  }
  return data;
}

export async function searchCoins(query: string, signal?: AbortSignal): Promise<CoinSearchResult[]> {
  const data = await get<{ coins: CoinSearchResult[] }>(
    `/search?query=${encodeURIComponent(query)}`,
    signal,
  );
  return data.coins.slice(0, 8);
}

// Stocks and ETFs come from Finnhub with the user's own key: keyed APIs can't ship a key in a public
// build, and Yahoo and friends can't be called from the browser. No decoys here: the key already ties
// every request to the user's Finnhub account.
const FINNHUB = "https://finnhub.io/api/v1";

async function finnhubGet<T>(path: string, key: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    // As a query parameter: Finnhub's CORS preflight doesn't allow the X-Finnhub-Token header.
    const sep = path.includes("?") ? "&" : "?";
    res = await fetch(`${FINNHUB}${path}${sep}token=${encodeURIComponent(key)}`, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("Can't reach the stock price service. Check your connection.");
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("Your Finnhub API key was rejected. Check it in Edit → Stock prices.");
  }
  if (res.status === 429) {
    throw new Error("The stock price service is rate-limiting requests. Try again in a minute.");
  }
  if (!res.ok) throw new Error(`The stock price service returned an error (${res.status}).`);
  return res.json() as Promise<T>;
}

// The free tier only quotes US listings; other exchanges have a suffix like "SAP.DE".
const STOCK_TYPES = new Set(["Common Stock", "ETP", "ADR", "REIT"]);

export async function searchStocks(query: string, key: string, signal?: AbortSignal): Promise<StockSearchResult[]> {
  const data = await finnhubGet<{ result?: StockSearchResult[] }>(
    `/search?q=${encodeURIComponent(query)}`,
    key,
    signal,
  );
  return (data.result ?? []).filter((r) => !r.symbol.includes(".") && STOCK_TYPES.has(r.type)).slice(0, 8);
}

// c: current price, dp: % change from the previous close. An unknown symbol comes back as all zeros.
interface Quote {
  c?: number;
  dp?: number | null;
}

// USD quotes keyed by holding id, one request per ticker (the free tier allows 60 a minute).
export async function fetchStockQuotes(tickers: string[], key: string, signal?: AbortSignal): Promise<PriceMap> {
  const quotes = await Promise.all(
    tickers.map((t) => finnhubGet<Quote>(`/quote?symbol=${encodeURIComponent(t)}`, key, signal)),
  );
  const data: PriceMap = {};
  quotes.forEach((q, i) => {
    if (!q.c) return;
    data[stockId(tickers[i])] = { usd: q.c, usd_24h_change: q.dp ?? undefined };
  });
  return data;
}

// Throws the "rejected" error when Finnhub doesn't accept the key.
export async function validateKey(key: string, signal?: AbortSignal): Promise<void> {
  try {
    await finnhubGet<Quote>("/quote?symbol=SPY", key, signal);
  } catch (e) {
    // The generic message points to the settings, which is where this form already is.
    if (e instanceof Error && e.message.includes("rejected")) {
      throw new Error("Finnhub didn't accept that key. Copy it again from your Finnhub dashboard.");
    }
    throw e;
  }
}
