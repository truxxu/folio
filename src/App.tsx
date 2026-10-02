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
  persist,
  requestPersistence,
  type Vault,
} from "./storage";
import { isMarket, kindOf, type AppState, type Currency, type Holding, type HoldingKind, type PriceCache } from "./types";
import { holdingPrice } from "./value";

const REFRESH_MS = 5 * 60_000;
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
  const [exporting, setExporting] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [, setTick] = useState(0);

  useEffect(() => persist(vault, state, prices), [vault, state, prices]);
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

  // CoinGecko ids (crypto and tokenized stocks); cash and accounts are valued from the fiat rates fetched alongside.
  const ids = useMemo(
    () =>
      state.holdings
        .filter(isMarket)
        .map((h) => h.id)
        .sort()
        .join(","),
    [state.holdings],
  );
  const hasHoldings = state.holdings.length > 0;

  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!hasHoldings || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const cache = { ...(await fetchPrices(ids ? ids.split(",") : [])), fetchedAt: Date.now() };
      setPrices(cache);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update prices.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [ids, hasHoldings]);

  // Fetch when the app opens or the set of coins changes, unless the cache is fresh and complete.
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  useEffect(() => {
    const cache = pricesRef.current;
    const fresh = cache && Date.now() - cache.fetchedAt < 60_000;
    const complete = cache?.rates && ids.split(",").every((id) => !id || cache.data[id]);
    if (!(fresh && complete)) refresh();
  }, [ids, refresh]);

  // Periodic refresh while the app is visible; also re-render the "updated x ago" text.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const check = () => {
      setTick((n) => n + 1);
      const age = Date.now() - (pricesRef.current?.fetchedAt ?? 0);
      if (document.visibilityState === "visible" && navigator.onLine && age > REFRESH_MS) {
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
  const lockRef = useRef(() => {});
  lockRef.current = () => vault && onLock();
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
      if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) lockRef.current();
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

  // Tapping the eye turns hiding on for good; after that it only reveals until the app is left.
  const toggleMask = () => {
    if (!state.hideBalances) {
      setHideBalances(true);
      setRevealed(false);
    } else setRevealed((r) => !r);
  };

  const restore = (restored: AppState) => {
    if (state.holdings.length && !confirm("Replace your current holdings with this backup?")) return;
    setState({ ...restored, hideBalances: state.hideBalances });
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
            Add your coins, cash and accounts with the amount you hold. Amounts stay on this device. Only coin
            names are sent out, to look up prices.
          </p>
        </section>
        <AddHolding variant="inline" existingIds={[]} currency={cur} prices={prices} onAdd={addHolding} />
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

  let status: string;
  if (loading) status = "Updating prices…";
  else if (error && prices) status = `${error} Showing prices from ${timeAgo(prices.fetchedAt)}.`;
  else if (error) status = error;
  else if (!online && prices) status = `Offline. Showing prices from ${timeAgo(prices.fetchedAt)}.`;
  else if (!online) status = "Offline. Prices will load when you're back online.";
  else if (prices) status = `Prices updated ${timeAgo(prices.fetchedAt)}`;
  else status = "";

  // Prices on screen may be out of date: show a banner instead of the quiet status line.
  const stale = !loading && (!online || !!error);

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
                <span key={r.id} style={{ flexGrow: r.value!, "--coin": r.color } as CSSProperties} />
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
                <HoldingRow key={r.id} row={r} cur={cur} stale={stale} masked={masked} />
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

function HoldingRow({ row: r, cur, stale, masked }: { row: Row; cur: Currency; stale: boolean; masked: boolean }) {
  const fiat = !isMarket(r);
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
          {r.value === null ? (fiat ? "No rate yet" : "No price yet") : masked ? MASK : formatMoney(r.value, cur)}
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
      <AmountInput holding={row} onSave={onSave} onInvalid={setInvalid} />
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
