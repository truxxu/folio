import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AddHolding } from "./AddHolding";
import { coinColor, Tile } from "./Tile";
import { fetchPrices } from "./api";
import {
  amountToInput,
  formatAmount,
  formatMoney,
  formatMoneyParts,
  formatPercent,
  parseAmount,
  timeAgo,
} from "./format";
import {
  exportBackup,
  loadPrices,
  loadState,
  parseBackup,
  requestPersistence,
  savePrices,
  saveState,
} from "./storage";
import { kindOf, type AppState, type Currency, type Holding, type HoldingKind, type PriceCache } from "./types";
import { holdingPrice } from "./value";

const REFRESH_MS = 5 * 60_000;

type Row = Holding & { price: number | null; change: number | null; value: number | null; color: string };

const GROUPS: [HoldingKind, string][] = [
  ["crypto", "Crypto"],
  ["cash", "Cash"],
  ["account", "Accounts"],
];

// Short name for the allocation legend: the ticker or currency, or the account's own name.
const label = (r: Row) => (kindOf(r) === "account" ? (r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name) : r.symbol);

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [prices, setPrices] = useState<PriceCache | null>(loadPrices);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [, setTick] = useState(0);

  useEffect(() => saveState(state), [state]);
  useEffect(() => {
    requestPersistence();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // CoinGecko ids only; cash and accounts are valued from the fiat rates fetched alongside.
  const ids = useMemo(
    () =>
      state.holdings
        .filter((h) => kindOf(h) === "crypto")
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
      savePrices(cache);
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

  const cur = state.currency;
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

  async function importFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const restored = parseBackup(await file.text());
      if (state.holdings.length && !confirm("Replace your current holdings with this backup?")) return;
      setState(restored);
      setNotice(`Restored ${restored.holdings.length} holding${restored.holdings.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  const importControl = (className: string, children: ReactNode) => (
    <label className={className}>
      {children}
      <input type="file" accept="application/json,.json" className="visually-hidden" onChange={importFile} />
    </label>
  );

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

        <h2 className="label section">Backup</h2>
        <div className="card">
          <button type="button" className="card-row" onClick={() => exportBackup(state)}>
            <span>Export backup</span>
            <span className="mono muted">↓ .json</span>
          </button>
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
  const share = (r: Row) => Math.round((r.value! / total) * 100);
  const allocLabel = valued.map((r) => `${label(r)} ${share(r)}%`).join(", ");
  const [whole, cents] = formatMoneyParts(total, cur);
  const delta = total - previous;

  return (
    <main className={`app with-bar${stale ? " stale" : ""}`}>
      <header className="top">
        <Brand />
        <div className="toggle mono" role="group" aria-label="Currency">
          {(["usd", "cop"] as const).map((c) => (
            <button key={c} type="button" aria-pressed={cur === c} onClick={() => setCurrency(c)}>
              {c.toUpperCase()}
            </button>
          ))}
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
                {delta >= 0 ? "+" : "−"}
                {formatMoney(Math.abs(delta), cur)} in 24 h
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
                  {label(r)} {share(r)}%
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
              <span>{prices ? formatMoney(subtotal, cur) : "—"}</span>
            </h2>
            <ul>
              {group.map((r) => (
                <HoldingRow key={r.id} row={r} cur={cur} stale={stale} />
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

function HoldingRow({ row: r, cur, stale }: { row: Row; cur: Currency; stale: boolean }) {
  const fiat = kindOf(r) !== "crypto";
  return (
    <li className="row">
      <Tile symbol={r.symbol} color={r.value ? r.color : undefined} />
      <div className="coin">
        <strong>{r.name}</strong>
        <span className="mono">
          {formatAmount(r.amount)} {r.symbol}
        </span>
      </div>
      <div className="value mono">
        <strong>{r.value === null ? (fiat ? "No rate yet" : "No price yet") : formatMoney(r.value, cur)}</strong>
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
