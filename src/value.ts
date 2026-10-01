import { kindOf, type Currency, type Fiat, type Holding, type PriceCache } from "./types";

export const FIAT_NAMES: Record<Fiat, string> = { usd: "US dollars", eur: "Euros", cop: "Colombian pesos" };

// Value of 1 unit of `from` in `to`, or null when a rate is missing.
export function fiatPrice(rates: PriceCache["rates"], from: Fiat, to: Fiat): number | null {
  if (from === to) return 1;
  const a = rates?.[from];
  const b = rates?.[to];
  return a && b ? b / a : null;
}

// Unit price and 24h change of a holding in the display currency. Cash and accounts have no 24h
// change: moves in the exchange rate are ignored, like the COP approximation in api.ts.
export function holdingPrice(
  h: Holding,
  prices: PriceCache | null | undefined,
  cur: Currency,
): { price: number | null; change: number | null } {
  if (kindOf(h) !== "crypto") {
    return { price: h.fiat ? fiatPrice(prices?.rates, h.fiat, cur) : null, change: null };
  }
  const p = prices?.data[h.id];
  return { price: p?.[cur] ?? null, change: p?.[`${cur}_24h_change`] ?? null };
}
