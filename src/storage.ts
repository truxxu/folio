import { deriveKey, isSealed, ITERATIONS, newSalt, open, openWith, seal, sealWith, type Sealed } from "./crypto";
import { FIATS, type AppState, type Fiat, type Holding, type PriceCache } from "./types";

const STATE_KEY = "folio:state:v1";
const PRICE_KEY = "folio:prices:v1";
const LOCK_KEY = "folio:lock:v1";

export const EMPTY: AppState = { version: 1, holdings: [], currency: "usd" };

// With a passcode set, both keys hold `Sealed` blobs encrypted with this key. It only lives in memory.
export interface Vault {
  key: CryptoKey;
  salt: string;
  iterations: number;
}

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
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (e.g. some private-browsing modes); the app still works for this session.
  }
}

// Stocks used to be tokenized stocks priced by CoinGecko, with the CoinGecko id as their id. Those are
// dropped: stocks are now "stock:<TICKER>" and priced by Finnhub.
const dropLegacyStocks = (holdings: Holding[]) =>
  holdings.filter((h) => h.kind !== "stock" || h.id.startsWith("stock:"));

const toState = (saved: AppState): AppState => ({ ...EMPTY, ...saved, holdings: dropLegacyStocks(saved.holdings) });

// Null when the data is locked behind a passcode (see `unlock`).
export function loadState(): AppState | null {
  const saved = read<unknown>(STATE_KEY);
  if (isSealed(saved)) return null;
  const s = saved as AppState | null;
  return s && Array.isArray(s.holdings) ? toState(s) : EMPTY;
}

// A sealed cache is read by `unlock` instead.
export function loadPrices(): PriceCache | null {
  const saved = read<PriceCache>(PRICE_KEY);
  return isSealed(saved) ? null : saved;
}

// Writes go through one queue so a slow encryption can't land after (and overwrite) a newer write.
let queue = Promise.resolve();

export function persist(vault: Vault | null, state: AppState, prices: PriceCache | null) {
  queue = queue
    .then(async () => {
      if (!vault) {
        write(STATE_KEY, state);
        write(PRICE_KEY, prices);
        return;
      }
      const { key, salt, iterations } = vault;
      const [s, p] = await Promise.all([
        sealWith(key, salt, iterations, state),
        prices && sealWith(key, salt, iterations, prices),
      ]);
      write(STATE_KEY, s);
      write(PRICE_KEY, p);
    })
    .catch(() => {});
}

// What another tab last saved, as this tab would load it. Null when it's sealed with a key this tab
// doesn't hold (a passcode set or changed elsewhere), so the caller locks.
export async function readSaved(
  vault: Vault | null,
): Promise<{ vault: Vault | null; state: AppState; prices: PriceCache | null } | null> {
  const state = loadState();
  if (state) return { vault: null, state, prices: loadPrices() };
  const sealed = read<unknown>(STATE_KEY);
  if (!vault || !isSealed(sealed) || sealed.salt !== vault.salt) return null;
  try {
    return await openSession(vault, sealed);
  } catch {
    return null;
  }
}

// Opens the sealed state with `vault` (throws when the key is wrong) and the price cache if it can.
async function openSession(vault: Vault, sealed: Sealed) {
  const state = toState((await openWith(vault.key, sealed)) as AppState);
  const savedPrices = read<unknown>(PRICE_KEY);
  let prices: PriceCache | null = null;
  try {
    if (isSealed(savedPrices)) prices = (await openWith(vault.key, savedPrices)) as PriceCache;
  } catch {
    // An unreadable price cache just means fetching again.
  }
  return { vault, state, prices };
}

// Calls `cb` when another tab saves the state (the `storage` event never fires in the tab that wrote).
export function onSavedChange(cb: () => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === STATE_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

export async function createVault(passcode: string): Promise<Vault> {
  const salt = newSalt();
  return { key: await deriveKey(passcode, salt), salt, iterations: ITERATIONS };
}

// Reads the sealed data once pending writes are done. Throws when the passcode is wrong.
export async function unlock(passcode: string): Promise<{ vault: Vault; state: AppState; prices: PriceCache | null }> {
  await queue;
  const sealed = read<unknown>(STATE_KEY);
  if (!isSealed(sealed)) throw new Error("Nothing to unlock.");
  const { salt, iterations } = sealed;
  return openSession({ key: await deriveKey(passcode, salt, iterations), salt, iterations }, sealed);
}

export function eraseAll() {
  queue = queue.then(() => {
    for (const k of [STATE_KEY, PRICE_KEY, LOCK_KEY]) write(k, null);
  });
}

// Wrong-passcode throttling: after 5 failures each further attempt waits 30 s, doubling every time.
// This only slows down guessing in the UI; the PBKDF2 cost is what protects the stored data.
interface LockAttempts {
  fails: number;
  until: number;
}

export const lockWaitUntil = () => read<LockAttempts>(LOCK_KEY)?.until ?? 0;

export function recordUnlock(ok: boolean) {
  if (ok) return write(LOCK_KEY, null);
  const fails = (read<LockAttempts>(LOCK_KEY)?.fails ?? 0) + 1;
  write(LOCK_KEY, { fails, until: fails >= 5 ? Date.now() + 30_000 * 2 ** (fails - 5) : 0 });
}

// Ask the browser not to evict our data under storage pressure.
export async function requestPersistence() {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
}

// With a password the file holds a `Sealed` copy of the state instead of plain JSON.
export async function exportBackup(state: AppState, password?: string) {
  // The API key stays on this device: a backup without a password would hand it to anyone with the file.
  const { hideBalances: _, finnhubKey: __, ...data } = state;
  const content = password ? { folio: "backup", ...(await seal(password, data)) } : data;
  const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `folio-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Backups from before cash/accounts have no `kind`; those are crypto.
function isHolding(h: unknown): h is Holding {
  if (typeof h !== "object" || h === null) return false;
  const o = h as Record<string, unknown>;
  const base =
    typeof o.id === "string" &&
    typeof o.symbol === "string" &&
    typeof o.name === "string" &&
    typeof o.amount === "number" &&
    Number.isFinite(o.amount) &&
    o.amount >= 0;
  if (!base) return false;
  if (o.kind === undefined || o.kind === "crypto" || o.kind === "stock") return true;
  return (o.kind === "cash" || o.kind === "account") && FIATS.includes(o.fiat as Fiat);
}

function toBackupState(data: unknown): AppState {
  const o = data as Partial<AppState>;
  if (!o || !Array.isArray(o.holdings) || !o.holdings.every(isHolding)) {
    throw new Error("That file isn't a Folio backup.");
  }
  return {
    version: 1,
    holdings: dropLegacyStocks(o.holdings),
    currency: o.currency === "cop" ? "cop" : "usd",
  };
}

// Returns the state for a plain backup, or the sealed contents of a password-protected one.
export function parseBackup(text: string): { state: AppState } | { sealed: Sealed } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (isSealed(data)) return { sealed: data };
  return { state: toBackupState(data) };
}

export async function openBackup(password: string, sealed: Sealed): Promise<AppState> {
  let data: unknown;
  try {
    data = await open(password, sealed);
  } catch {
    throw new Error("Wrong password.");
  }
  return toBackupState(data);
}
