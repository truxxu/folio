import type { AppState, Holding, PriceCache } from "./types";

const STATE_KEY = "folio:state:v1";
const PRICE_KEY = "folio:prices:v1";

const EMPTY: AppState = { version: 1, holdings: [], currency: "usd" };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (e.g. some private-browsing modes); the app still works for this session.
  }
}

export function loadState(): AppState {
  const saved = read<AppState>(STATE_KEY);
  return saved && Array.isArray(saved.holdings) ? { ...EMPTY, ...saved } : EMPTY;
}

export const saveState = (state: AppState) => write(STATE_KEY, state);
export const loadPrices = () => read<PriceCache>(PRICE_KEY);
export const savePrices = (cache: PriceCache) => write(PRICE_KEY, cache);

// Ask the browser not to evict our data under storage pressure.
export async function requestPersistence() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
}

export function exportBackup(state: AppState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `folio-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function isHolding(h: unknown): h is Holding {
  if (typeof h !== "object" || h === null) return false;
  const o = h as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.symbol === "string" &&
    typeof o.name === "string" &&
    typeof o.amount === "number" &&
    Number.isFinite(o.amount) &&
    o.amount >= 0
  );
}

export function parseBackup(text: string): AppState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const o = data as Partial<AppState>;
  if (!o || !Array.isArray(o.holdings) || !o.holdings.every(isHolding)) {
    throw new Error("That file isn't a Folio backup.");
  }
  return {
    version: 1,
    holdings: o.holdings,
    currency: o.currency === "cop" ? "cop" : "usd",
  };
}
