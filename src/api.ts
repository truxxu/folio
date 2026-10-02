import { FIATS, type CoinSearchResult, type PriceMap, type Rates } from "./types";

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
// A rate that can't be fetched is left out; USD always works.
async function fetchUsdRates(signal?: AbortSignal): Promise<Rates> {
  const rates: Rates = { usd: 1 };
  try {
    const res = await fetch("https://api.yadio.io/exrates/USD", { signal });
    if (!res.ok) return rates;
    const { USD } = (await res.json()) as { USD?: Record<string, unknown> };
    for (const f of FIATS) {
      const rate = USD?.[f.toUpperCase()];
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[f] = rate;
    }
  } catch {
    // keep just USD
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

export async function fetchPrices(
  ids: string[],
  signal?: AbortSignal,
): Promise<{ data: PriceMap; rates: Rates }> {
  const params = new URLSearchParams({
    ids: [...new Set([...ids, ...DECOY_IDS])].sort().join(","),
    vs_currencies: "usd",
    include_24hr_change: "true",
  });
  // A portfolio with only cash and accounts doesn't need CoinGecko (and its rate limit) at all.
  const [data, rates] = await Promise.all([
    ids.length ? get<PriceMap>(`/simple/price?${params}`, signal) : Promise.resolve({} as PriceMap),
    fetchUsdRates(signal),
  ]);
  if (rates.cop !== undefined) {
    for (const p of Object.values(data)) {
      if (p.usd === undefined) continue;
      p.cop = p.usd * rates.cop;
      // Approximation: ignores how the USD/COP rate itself moved over the last 24h.
      p.cop_24h_change = p.usd_24h_change;
    }
  }
  return { data, rates };
}

export async function searchCoins(query: string, signal?: AbortSignal): Promise<CoinSearchResult[]> {
  const data = await get<{ coins: CoinSearchResult[] }>(
    `/search?query=${encodeURIComponent(query)}`,
    signal,
  );
  return data.coins.slice(0, 8);
}

// Stocks and ETFs come from tokenized versions on CoinGecko (Yahoo and friends can't be called from
// the browser). Each family is matched by its CoinGecko id and adds a fixed affix to the ticker.
const STOCK_FAMILIES: { match: RegExp; label: string; prefix?: string; suffix?: string }[] = [
  { match: /-xstock$/, label: "xStock", suffix: "X" },
  { match: /-ondo-tokenized/, label: "Ondo", suffix: "ON" },
  { match: /-bstocks-tokenized/, label: "bStocks", suffix: "B" },
  { match: /-coinbase-tokenized/, label: "Coinbase", suffix: "C" },
  { match: /-rstock$/, label: "rStock", prefix: "R" },
  { match: /-robinhood-tokenized/, label: "Robinhood" },
  { match: /-dinari-tokenized/, label: "Dinari" },
];

const stockFamily = (id: string) => STOCK_FAMILIES.find((f) => f.match.test(id));

// The issuer of a tokenized stock, e.g. "Robinhood", to tell apart tokens of the same stock.
export const stockFamilyLabel = (id: string) => stockFamily(id)?.label ?? "";

// The real ticker behind a token symbol, e.g. SPYX → SPY.
export function stockTicker(c: CoinSearchResult): string {
  let s = c.symbol.toUpperCase();
  const f = stockFamily(c.id);
  if (f?.suffix && s.length > f.suffix.length && s.endsWith(f.suffix)) s = s.slice(0, -f.suffix.length);
  if (f?.prefix && s.length > f.prefix.length && s.startsWith(f.prefix)) s = s.slice(f.prefix.length);
  return s;
}

export async function searchStocks(query: string, signal?: AbortSignal): Promise<CoinSearchResult[]> {
  const data = await get<{ coins: CoinSearchResult[] }>(
    `/search?query=${encodeURIComponent(query)}`,
    signal,
  );
  return data.coins.filter((c) => stockFamily(c.id)).slice(0, 8);
}
