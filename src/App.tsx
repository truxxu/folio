import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AddHolding } from "./AddHolding";
import { ImportBackup, NewSecretForm } from "./Backup";
import { Lock } from "./Lock";
import { FINNHUB_SIGNUP, StockKeyForm } from "./StockKey";
import { coinColor, Tile } from "./Tile";
import { fetchPrices } from "./api";
import {
  amountToInput,
  formatAmount,
  formatMoney,
  formatMoneyParts,
  formatPercent,
  MASK,
  parseAmount,
  timeAgo,
} from "./format";
import {
  createVault,
  EMPTY,
  eraseAll,
  exportBackup,
  loadPrices,
  loadState,
  onSavedChange,
  persist,
  readSaved,
  requestPersistence,
  type Vault,
} from "./storage";
import { FIATS, isCrypto, isFiat, isStock, kindOf, stockId, type AppState, type Currency, type Holding, type HoldingKind, type PriceCache } from "./types";
import { holdingPrice } from "./value";

const REFRESH_MS = 5 * 60_000;
const RETRY_MS = 60_000;
// With a passcode set, coming back after this long in the background asks for it again.
const LOCK_AFTER_MS = 60_000;

type Row = Holding & { price: number | null; change: number | null; value: number | null; color: string };

const GROUPS: [HoldingKind, string][] = [
  ["crypto", "Crypto"],
  ["stock", "Stocks & ETFs"],
  ["cash", "Cash"],
  ["account", "Accounts"],
];

// Short name for the allocation legend: the ticker or currency, or the account's own name.
const label = (r: Row) => (kindOf(r) === "account" ? (r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name) : r.symbol);

// The same array for as long as the set of values stays the same, so effects only re-run when it changes.
function useStableList(list: string[]): string[] {
  const joined = [...list].sort().join(",");
  return useMemo(() => (joined ? joined.split(",") : []), [joined]);
}

type Session = { state: AppState; prices: PriceCache | null; vault: Vault | null };

export default function App() {
  // Null while locked: the data is encrypted and the key is only kept in memory after unlocking.
  const [session, setSession] = useState<Session | null>(() => {
    const state = loadState();
    return state && { state, prices: loadPrices(), vault: null };
  });

  useEffect(() => {
    requestPersistence();
  }, []);

  if (!session) {
    return (
      <Lock
        brand={<Brand />}
        onUnlock={setSession}
        onReplace={(state) => {
          eraseAll();
          setSession({ state: state ?? EMPTY, prices: null, vault: null });
        }}
      />
    );
  }
  return <Portfolio initial={session} onLock={() => setSession(null)} />;
}

function Portfolio({ initial, onLock }: { initial: Session; onLock: () => void }) {
  const [state, setState] = useState(initial.state);
  const [prices, setPrices] = useState(initial.prices);
  const [vault, setVault] = useState(initial.vault);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [settingPasscode, setSettingPasscode] = useState(false);
  const [settingKey, setSettingKey] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [, setTick] = useState(0);

  // Set when adopting data another tab saved, so it isn't written straight back (which, re-encrypted
  // with a new IV, would wake that tab and loop).
  const skipPersist = useRef(false);
  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    persist(vault, state, prices);
  }, [vault, state, prices]);

  // Another tab saved: follow it, or lock if it now uses a passcode this tab doesn't hold, so this
  // tab never writes plaintext or the old key over it.
  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;
  useEffect(
    () =>
      onSavedChange(async () => {
        const saved = await readSaved(vaultRef.current);
        if (!saved) return onLockRef.current();
        skipPersist.current = true;
        setState(saved.state);
        setPrices(saved.prices);
        setVault(saved.vault);
      }),
    [],
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // CoinGecko ids for crypto and tickers for stocks (Finnhub, only with a key); cash and accounts are
  // valued from the fiat rates fetched alongside.
  const key = state.finnhubKey;
  const idList = useStableList(state.holdings.filter(isCrypto).map((h) => h.id));
  const tickerList = useStableList(key ? state.holdings.filter(isStock).map((h) => h.symbol) : []);
  const hasHoldings = state.holdings.length > 0;

  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!hasHoldings || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const last = pricesRef.current;
      const stocks = key && tickerList.length ? { tickers: tickerList, key } : null;
      const { data, rates, stockError } = await fetchPrices(idList, stocks, last?.rates);
      // Keep the last price of any stock Finnhub didn't return this time (failed, or an unknown ticker),
      // remembering when the oldest of them was really fetched.
      let staleSince: number | undefined;
      for (const t of tickerList) {
        const id = stockId(t);
        if (data[id] || !last?.data[id]) continue;
        data[id] = last.data[id];
        staleSince = Math.min(staleSince ?? Infinity, last.staleSince ?? last.fetchedAt);
      }
      const fetchedAt = Date.now();
      setPrices(staleSince === undefined ? { data, rates, fetchedAt } : { data, rates, fetchedAt, staleSince });
      if (stockError) setError(stockError);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update prices.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [idList, tickerList, key, hasHoldings]);

  // Fetch when the app opens or the set of coins, stocks or the key changes, unless the cache is fresh
  // and complete. Without a key `tickerList` is empty, so stocks never count as missing.
  useEffect(() => {
    const cache = pricesRef.current;
    const fresh = cache && Date.now() - cache.fetchedAt < 60_000;
    const complete =
      cache &&
      FIATS.every((f) => cache.rates?.[f]) &&
      idList.every((id) => cache.data[id]) &&
      !cache.staleSince &&
      tickerList.every((t) => cache.data[stockId(t)]);
    if (!(fresh && complete)) refresh();
  }, [idList, tickerList, refresh]);

  // Periodic refresh while the app is visible; also re-render the "updated x ago" text.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const check = () => {
      setTick((n) => n + 1);
      const cache = pricesRef.current;
      const age = Date.now() - (cache?.fetchedAt ?? 0);
      // Stock prices left over from a failed fetch are retried sooner.
      const due = age > (cache?.staleSince ? RETRY_MS : REFRESH_MS);
      if (document.visibilityState === "visible" && navigator.onLine && due) {
        refreshRef.current();
      }
    };
    const timer = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, []);

  // Leaving the app re-hides balances and blurs the screen, so the app switcher and anyone watching
  // when it's reopened don't see them. Best-effort: iOS may take its snapshot before the blur paints,
  // and a web app can't block screenshots.
  useEffect(() => {
    const root = document.documentElement;
    let hiddenAt = 0;
    const shield = () => root.classList.add("shielded");
    const unshield = () => root.classList.remove("shielded");
    const hide = () => {
      hiddenAt ||= Date.now();
      setRevealed(false);
      shield();
    };
    const show = () => {
      unshield();
      if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS && vaultRef.current) onLockRef.current();
      hiddenAt = 0;
    };
    const visibility = () => (document.visibilityState === "hidden" ? hide() : show());
    // Android Chrome fires blur before the app-switcher snapshot.
    window.addEventListener("blur", shield);
    window.addEventListener("focus", unshield);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      unshield();
      window.removeEventListener("blur", shield);
      window.removeEventListener("focus", unshield);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  const cur = state.currency;
  const masked = !!state.hideBalances && !revealed;
  const money = (n: number) => (masked ? MASK : formatMoney(n, cur));
  const rows: Row[] = useMemo(() => {
    const list = state.holdings.map((h) => {
      const { price, change } = holdingPrice(h, prices, cur);
      return { ...h, price, change, value: price === null ? null : price * h.amount, color: "" };
    });
    list.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    return list.map((r, i) => ({ ...r, color: coinColor(i) }));
  }, [state.holdings, prices, cur]);

  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const previous = rows.reduce(
    (s, r) => s + (r.value === null ? 0 : r.change === null ? r.value : r.value / (1 + r.change / 100)),
    0,
  );
  const totalChange = previous > 0 && rows.some((r) => r.change !== null) ? (total / previous - 1) * 100 : null;

  const update = (fn: (holdings: Holding[]) => Holding[]) =>
    setState((s) => ({ ...s, holdings: fn(s.holdings) }));

  const addHolding = (h: Holding) => {
    update((hs) => [...hs, h]);
    setAdding(false);
  };
  const setAmount = (id: string, amount: number) =>
    update((hs) => hs.map((h) => (h.id === id ? { ...h, amount } : h)));
  const remove = (h: Holding) => {
    if (!confirm(`Remove ${h.name} from your portfolio?`)) return;
    update((hs) => hs.filter((x) => x.id !== h.id));
    if (state.holdings.length === 1) setEditing(false);
  };
  const setCurrency = (currency: Currency) => setState((s) => ({ ...s, currency }));
  const setHideBalances = (hideBalances: boolean) => setState((s) => ({ ...s, hideBalances }));
  const setFinnhubKey = (finnhubKey: string | undefined) => setState((s) => ({ ...s, finnhubKey }));

  // Tapping the eye turns hiding on for good; after that it only reveals until the app is left.
  const toggleMask = () => {
    if (!state.hideBalances) {
      setHideBalances(true);
      setRevealed(false);
    } else setRevealed((r) => !r);
  };

  const restore = (restored: AppState) => {
    if (state.holdings.length && !confirm("Replace your current holdings with this backup?")) return;
    // Backups never carry the API key, so the one on this device stays.
    setState({ ...restored, hideBalances: state.hideBalances, finnhubKey: state.finnhubKey });
    setNotice(`Restored ${restored.holdings.length} holding${restored.holdings.length === 1 ? "" : "s"}.`);
  };

  const importControl = (className: string, children: ReactNode) => (
    <ImportBackup className={className} onRestore={restore} onError={setNotice}>
      {children}
    </ImportBackup>
  );

  const turnOffPasscode = () => {
    if (!confirm("Turn off the passcode? Your holdings will be stored unencrypted on this device.")) return;
    setVault(null);
    setNotice("Passcode turned off.");
  };

  if (state.holdings.length === 0) {
    return (
      <main className="app first-run">
        <div className="glow" aria-hidden />
        <header className="top">
          <Brand />
        </header>
        <section className="welcome">
          <h1>What do you hold?</h1>
          <p>
            Add your coins, stocks, cash and accounts with the amount you hold. Amounts stay on this device.
            Only coin names and stock tickers are sent out, to look up prices.
          </p>
        </section>
        <AddHolding
          variant="inline"
          existingIds={[]}
          currency={cur}
          prices={prices}
          finnhubKey={key}
          onSetKey={setFinnhubKey}
          onAdd={addHolding}
        />
        <footer className="restore">
          {importControl("text-btn mono", "↑ Restore from a backup file")}
          {notice && <span role="status">{notice}</span>}
        </footer>
      </main>
    );
  }

  if (editing) {
    return (
      <main className="app">
        <header className="top">
          <h1 className="title">Edit amounts</h1>
          <button type="button" className="pill-btn" onClick={() => setEditing(false)}>
            Done
          </button>
        </header>
        <ul className="card">
          {rows.map((r) => (
            <EditRow key={r.id} row={r} onSave={(n) => setAmount(r.id, n)} onRemove={() => remove(r)} />
          ))}
        </ul>

        <h2 className="label section">Privacy</h2>
        <div className="card">
          <button
            type="button"
            className="card-row"
            role="switch"
            aria-checked={!!state.hideBalances}
            onClick={() => setHideBalances(!state.hideBalances)}
          >
            <span>Hide balances when opening</span>
            <span className="switch" aria-hidden />
          </button>
          {settingPasscode ? (
            <NewSecretForm
              label={vault ? "New passcode" : "Passcode"}
              minLength={6}
              hint="Longer is stronger. If you forget it, the only way back in is a backup, so export one first."
              submitLabel={() => (vault ? "Change passcode" : "Set passcode")}
              onSubmit={async (passcode) => {
                setVault(await createVault(passcode));
                setSettingPasscode(false);
                setNotice("Passcode set. Folio locks after a minute in the background.");
              }}
              onCancel={() => setSettingPasscode(false)}
            />
          ) : (
            <button type="button" className="card-row" onClick={() => setSettingPasscode(true)}>
              <span>{vault ? "Change passcode" : "Set passcode"}</span>
              <span className="mono muted">{vault ? "On" : "Off"}</span>
            </button>
          )}
          {vault && !settingPasscode && (
            <button type="button" className="card-row" onClick={turnOffPasscode}>
              <span>Turn off passcode</span>
            </button>
          )}
        </div>
        <p className="note mono">
          A passcode encrypts your holdings on this device and is asked for when Folio opens.
        </p>

        <h2 className="label section">Stock prices</h2>
        <div className="card">
          {settingKey ? (
            <StockKeyForm
              variant="card"
              onSave={(k) => {
                setFinnhubKey(k);
                setSettingKey(false);
                setNotice("Finnhub API key saved.");
              }}
              onCancel={() => setSettingKey(false)}
            />
          ) : (
            <>
              <button type="button" className="card-row" onClick={() => setSettingKey(true)}>
                <span>{key ? "Change Finnhub API key" : "Set Finnhub API key"}</span>
                <span className="mono muted">{key ? "On" : "Off"}</span>
              </button>
              {key && (
                <button type="button" className="card-row" onClick={() => setFinnhubKey(undefined)}>
                  <span>Remove key</span>
                </button>
              )}
            </>
          )}
        </div>
        <p className="note mono">
          Stocks are priced by Finnhub with your own free key from{" "}
          <a href={FINNHUB_SIGNUP} target="_blank" rel="noopener noreferrer">
            finnhub.io
          </a>
          . It stays on this device and isn't included in backups.
        </p>

        <h2 className="label section">Backup</h2>
        <div className="card">
          {exporting ? (
            <NewSecretForm
              label="Password (optional)"
              minLength={8}
              optional
              hint="Without a password, anyone who gets the file can read it."
              submitLabel={(password) => (password ? "Export encrypted" : "Export")}
              onSubmit={async (password) => {
                await exportBackup(state, password || undefined);
                setExporting(false);
              }}
              onCancel={() => setExporting(false)}
            />
          ) : (
            <button type="button" className="card-row" onClick={() => setExporting(true)}>
              <span>Export backup</span>
              <span className="mono muted">↓ .json</span>
            </button>
          )}
          {importControl(
            "card-row",
            <>
              <span>Import backup</span>
              <span className="mono muted">↑ .json</span>
            </>,
          )}
        </div>
        <p className="note mono">Amounts stay on this device.</p>
        {notice && (
          <p className="note mono" role="status">
            {notice}
          </p>
        )}
      </main>
    );
  }

  // The oldest price on screen, counting stock prices carried over from an earlier fetch.
  const shownAt = prices && (prices.staleSince ?? prices.fetchedAt);
  let status: string;
  if (loading) status = "Updating prices…";
  else if (error && shownAt) status = `${error} Showing prices from ${timeAgo(shownAt)}.`;
  else if (error) status = error;
  else if (!online && shownAt) status = `Offline. Showing prices from ${timeAgo(shownAt)}.`;
  else if (!online) status = "Offline. Prices will load when you're back online.";
  else if (prices?.staleSince && shownAt)
    status = `Couldn't update some stock prices. Showing them from ${timeAgo(shownAt)}.`;
  else if (prices) status = `Prices updated ${timeAgo(prices.fetchedAt)}`;
  else status = "";

  // Prices on screen may be out of date: show a banner instead of the quiet status line.
  const stale = !loading && (!online || !!error || !!prices?.staleSince);

  const valued = rows.filter((r) => r.value);
  // Shares are hidden too: next to a coin's price they give away the amount held.
  const share = (r: Row) => (masked ? "" : ` ${Math.round((r.value! / total) * 100)}%`);
  const allocLabel = valued.map((r) => `${label(r)}${share(r)}`).join(", ");
  const [whole, cents] = masked ? [MASK, ""] : formatMoneyParts(total, cur);
  const delta = total - previous;

  return (
    <main className={`app with-bar${stale ? " stale" : ""}`}>
      <header className="top">
        <Brand />
        <div className="top-actions">
          <button
            type="button"
            className="eye-btn"
            aria-label={masked ? "Show balances" : "Hide balances"}
            onClick={toggleMask}
          >
            <EyeIcon closed={masked} />
          </button>
          <div className="toggle mono" role="group" aria-label="Currency">
            {(["usd", "cop"] as const).map((c) => (
              <button key={c} type="button" aria-pressed={cur === c} onClick={() => setCurrency(c)}>
                {c.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </header>

      {stale && (
        <p className={`banner mono ${error ? "bad" : "warn"}`} role="status">
          <span className="dot" aria-hidden />
          {status}
        </p>
      )}

      <section className="summary" aria-live="polite">
        <p className="label">Total balance</p>
        <p className="total">
          {prices ? (
            <>
              {whole}
              <span className="cents">{cents}</span>
            </>
          ) : (
            "—"
          )}
        </p>
        {totalChange !== null &&
          (stale ? (
            <p className="delta mono">{formatPercent(totalChange)} in 24 h · cached</p>
          ) : (
            <p className="delta mono">
              <span className={`chip ${totalChange >= 0 ? "up" : "down"}`}>
                {totalChange >= 0 ? "▲" : "▼"} {formatPercent(totalChange)}
              </span>
              <span>
                {!masked && (delta >= 0 ? "+" : "−")}
                {money(Math.abs(delta))} in 24 h
              </span>
            </p>
          ))}
        {total > 0 && !stale && (
          <>
            <div className="alloc" role="img" aria-label={`Allocation: ${allocLabel}`}>
              {valued.map((r) => (
                <span key={r.id} style={{ flexGrow: masked ? 1 : r.value!, "--coin": r.color } as CSSProperties} />
              ))}
            </div>
            <ul className="legend mono" aria-hidden>
              {valued.map((r) => (
                <li key={r.id} style={{ "--coin": r.color } as CSSProperties}>
                  {label(r)}
                  {share(r)}
                </li>
              ))}
            </ul>
          </>
        )}
        {!stale && (
          <div className="status mono">
            <span className={error ? "error" : loading ? "busy" : undefined}>
              <span className="dot" aria-hidden />
              {status}
            </span>
            <button type="button" className="ghost-btn" onClick={refresh} disabled={loading || !online}>
              ↻ Refresh
            </button>
          </div>
        )}
      </section>

      {GROUPS.map(([kind, title]) => {
        const group = rows.filter((r) => kindOf(r) === kind);
        if (!group.length) return null;
        const subtotal = group.reduce((sum, r) => sum + (r.value ?? 0), 0);
        return (
          <section key={kind} className="card holdings">
            <h2 className="card-head label">
              <span>{title}</span>
              <span>{prices ? money(subtotal) : "—"}</span>
            </h2>
            <ul>
              {group.map((r) => (
                <HoldingRow key={r.id} row={r} cur={cur} stale={stale} masked={masked} hasKey={!!key} />
              ))}
            </ul>
          </section>
        );
      })}

      <div className="bar">
        {stale && !online ? (
          <button type="button" className="btn wide" disabled>
            ↻ Refresh when online
          </button>
        ) : (
          <button type="button" className="btn primary wide" onClick={() => setAdding(true)}>
            <span className="plus">+</span> Add
          </button>
        )}
        <button type="button" className="btn" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>

      {adding && (
        <AddHolding
          variant="sheet"
          existingIds={state.holdings.map((h) => h.id)}
          currency={cur}
          prices={prices}
          finnhubKey={key}
          onSetKey={setFinnhubKey}
          onAdd={addHolding}
          onCancel={() => setAdding(false)}
        />
      )}
    </main>
  );
}

function Brand() {
  return (
    <span className="brand">
      <span className="logo" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      Folio
    </span>
  );
}

function EyeIcon({ closed }: { closed: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {closed && <path d="M4 4l16 16" />}
    </svg>
  );
}

function HoldingRow({
  row: r,
  cur,
  stale,
  masked,
  hasKey,
}: {
  row: Row;
  cur: Currency;
  stale: boolean;
  masked: boolean;
  hasKey: boolean;
}) {
  const fiat = isFiat(r);
  const missing = fiat ? "No rate yet" : isStock(r) && !hasKey ? "Needs API key" : "No price yet";
  return (
    <li className="row">
      <Tile symbol={r.symbol} color={r.value ? r.color : undefined} />
      <div className="coin">
        <strong>{r.name}</strong>
        <span className="mono">
          {masked ? MASK : formatAmount(r.amount)} {r.symbol}
        </span>
      </div>
      <div className="value mono">
        <strong>
          {r.value === null ? missing : masked ? MASK : formatMoney(r.value, cur)}
        </strong>
        {r.price !== null &&
          (fiat ? (
            r.fiat !== cur && (
              <span>
                1 {r.symbol} = {formatMoney(r.price, cur)}
              </span>
            )
          ) : (
            <span>
              {formatMoney(r.price, cur)}
              {r.change !== null && !stale && (
                <em className={r.change >= 0 ? "up" : "down"}> {formatPercent(r.change)}</em>
              )}
            </span>
          ))}
      </div>
    </li>
  );
}

function EditRow({ row, onSave, onRemove }: { row: Row; onSave: (n: number) => void; onRemove: () => void }) {
  const [invalid, setInvalid] = useState(false);
  return (
    <li className="row edit-row">
      <Tile symbol={row.symbol} color={row.value ? row.color : undefined} />
      <div className="coin">
        <strong>{row.name}</strong>
        <span className={`mono${invalid ? " error" : ""}`} id={`amount-hint-${row.id}`}>
          {invalid ? "Must be above 0" : row.symbol}
        </span>
      </div>
      <AmountInput key={row.amount} holding={row} onSave={onSave} onInvalid={setInvalid} />
      <button type="button" className="remove" aria-label={`Remove ${row.name}`} onClick={onRemove}>
        ×
      </button>
    </li>
  );
}

function AmountInput({
  holding,
  onSave,
  onInvalid,
}: {
  holding: Holding;
  onSave: (n: number) => void;
  onInvalid: (invalid: boolean) => void;
}) {
  const [draft, setDraft] = useState(() => amountToInput(holding.amount));
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    const n = parseAmount(draft);
    const bad = n === null || n <= 0;
    setInvalid(bad);
    onInvalid(bad);
    if (!bad && n !== holding.amount) onSave(n);
  };

  return (
    <input
      className="field amount-field mono"
      inputMode="decimal"
      aria-label={`Amount of ${holding.name}`}
      aria-invalid={invalid || undefined}
      aria-describedby={`amount-hint-${holding.id}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
