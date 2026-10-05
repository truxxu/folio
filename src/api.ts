import { FIATS, stockId, type CoinSearchResult, type PriceMap, type Rates } from "./types";

// An HTTP error status, so callers can tell e.g. a rejected key apart without matching the message.
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// `service` names the API in user-facing errors; `messages` overrides the text for specific statuses.
async function request<T>(
  url: string,
  service: string,
  signal?: AbortSignal,
  messages: Record<number, string> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Can't reach the ${service}. Check your connection.`);
  }
  if (!res.ok) {
    const fallback =
      res.status === 429
        ? `The ${service} is rate-limiting requests. Try again in a minute.`
        : `The ${service} returned an error (${res.status}).`;
    throw new HttpError(res.status, messages[res.status] ?? fallback);
  }
  return res.json() as Promise<T>;
}

const BASE = "https://api.coingecko.com/api/v3";

const get = <T>(path: string, signal?: AbortSignal) => request<T>(BASE + path, "price service", signal);

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
// and no entries for the stocks that failed, so the caller can keep the last prices it had for them.
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
  // A portfolio without crypto doesn't need CoinGecko (and its rate limit) at all.
  const [coins, stockQuotes, fetched] = await Promise.all([
    ids.length ? get<PriceMap>(`/simple/price?${params}`, signal) : Promise.resolve({} as PriceMap),
    stocks?.tickers.length ? fetchStockQuotes(stocks.tickers, stocks.key, signal) : Promise.resolve({ data: {} as PriceMap, error: undefined }),
    fetchUsdRates(signal),
  ]);
  const data = { ...coins, ...stockQuotes.data };
  const rates: Rates = { ...fallback, ...fetched, usd: 1 };
  if (rates.cop !== undefined) addCop(data, rates.cop);
  return { data, rates, stockError: stockQuotes.error };
}

// Adds COP prices derived from USD ones, in place.
function addCop(data: PriceMap, cop: number) {
  for (const p of Object.values(data)) {
    if (p.usd === undefined) continue;
    p.cop = p.usd * cop;
    // Approximation: ignores how the USD/COP rate itself moved over the last 24h.
    p.cop_24h_change = p.usd_24h_change;
  }
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

const FINNHUB_MESSAGES = {
  401: "Your Finnhub API key was rejected. Check it in Edit → Stock prices.",
  // A valid key gets 403 for data its plan doesn't cover (e.g. a symbol outside the free tier).
  403: "Your Finnhub plan doesn't cover this data.",
};

function finnhubGet<T>(path: string, key: string, signal?: AbortSignal): Promise<T> {
  // As a query parameter: Finnhub's CORS preflight doesn't allow the X-Finnhub-Token header.
  const sep = path.includes("?") ? "&" : "?";
  const url = `${FINNHUB}${path}${sep}token=${encodeURIComponent(key)}`;
  return request<T>(url, "stock price service", signal, FINNHUB_MESSAGES);
}

interface StockSearchResult {
  symbol: string; // e.g. "AAPL"
  description: string; // e.g. "APPLE INC"
  type: string; // e.g. "Common Stock", "ETP"
}

// The free tier only quotes US listings, so the search is limited to US exchanges. Not filtered on a
// "." in the symbol: US class shares have one too ("BRK.B").
const STOCK_TYPES = new Set(["Common Stock", "ETP", "ADR", "REIT"]);

export async function searchStocks(query: string, key: string, signal?: AbortSignal): Promise<StockSearchResult[]> {
  const data = await finnhubGet<{ result?: StockSearchResult[] }>(
    `/search?q=${encodeURIComponent(query)}&exchange=US`,
    key,
    signal,
  );
  return (data.result ?? []).filter((r) => STOCK_TYPES.has(r.type)).slice(0, 8);
}

// c: current price, dp: % change from the previous close. An unknown symbol comes back as all zeros.
interface Quote {
  c?: number;
  dp?: number | null;
}

// Requests in flight at once: well under Finnhub's 30 calls/second burst limit.
const QUOTE_CONCURRENCY = 5;

// Errors that apply to every request, so the rest of the batch is skipped instead of sent anyway.
const BATCH_FATAL = new Set([401, 429]);

// USD quotes keyed by holding id, one request per ticker (the free tier allows 60 a minute).
// Each ticker succeeds or fails on its own, reported in `error`; this only throws when aborted.
async function fetchStockQuotes(
  tickers: string[],
  key: string,
  signal?: AbortSignal,
): Promise<{ data: PriceMap; error?: string }> {
  const data: PriceMap = {};
  const failed: string[] = [];
  let firstError: unknown;
  let next = 0;
  const worker = async () => {
    while (next < tickers.length) {
      const t = tickers[next++];
      try {
        const q = await finnhubGet<Quote>(`/quote?symbol=${encodeURIComponent(t)}`, key, signal);
        if (q.c) data[stockId(t)] = { usd: q.c, usd_24h_change: q.dp ?? undefined };
      } catch (e) {
        if (signal?.aborted) throw e;
        failed.push(t);
        firstError ??= e;
        if (e instanceof HttpError && BATCH_FATAL.has(e.status)) {
          failed.push(...tickers.slice(next));
          next = tickers.length;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(QUOTE_CONCURRENCY, tickers.length) }, worker));
  if (!failed.length) return { data };
  const message = firstError instanceof Error ? firstError.message : "Couldn't update stock prices.";
  // When none could be fetched, the cause alone says it; listing every ticker adds nothing.
  const error = failed.length === tickers.length ? message : `Couldn't update ${failed.sort().join(", ")}: ${message}`;
  return { data, error };
}

// Throws a specific error when Finnhub doesn't accept the key.
export async function validateKey(key: string, signal?: AbortSignal): Promise<void> {
  try {
    await finnhubGet<Quote>("/quote?symbol=SPY", key, signal);
  } catch (e) {
    // The generic message points to the settings, which is where this form already is.
    if (e instanceof HttpError && e.status === 401) {
      throw new Error("Finnhub didn't accept that key. Copy it again from your Finnhub dashboard.");
    }
    throw e;
  }
}
