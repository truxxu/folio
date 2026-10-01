import type { CoinSearchResult, PriceMap } from "./types";

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

// CoinGecko doesn't support COP, so the USD→COP rate comes from yadio.io.
async function fetchUsdCopRate(signal?: AbortSignal): Promise<number | null> {
  try {
    const res = await fetch("https://api.yadio.io/rate/COP/USD", { signal });
    if (!res.ok) return null;
    const { rate } = (await res.json()) as { rate?: unknown };
    return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

export async function fetchPrices(ids: string[], signal?: AbortSignal): Promise<PriceMap> {
  const params = new URLSearchParams({
    ids: ids.join(","),
    vs_currencies: "usd",
    include_24hr_change: "true",
  });
  const [data, rate] = await Promise.all([
    get<PriceMap>(`/simple/price?${params}`, signal),
    fetchUsdCopRate(signal),
  ]);
  if (rate !== null) {
    for (const p of Object.values(data)) {
      if (p.usd === undefined) continue;
      p.cop = p.usd * rate;
      // Approximation: ignores how the USD/COP rate itself moved over the last 24h.
      p.cop_24h_change = p.usd_24h_change;
    }
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
