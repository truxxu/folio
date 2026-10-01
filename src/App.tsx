import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { AddHolding } from "./AddHolding";
import { fetchPrices } from "./api";
import { amountToInput, formatAmount, formatMoney, formatPercent, parseAmount, timeAgo } from "./format";
import {
  exportBackup,
  loadPrices,
  loadState,
  parseBackup,
  requestPersistence,
  savePrices,
  saveState,
} from "./storage";
import type { AppState, Currency, Holding, PriceCache } from "./types";

const REFRESH_MS = 5 * 60_000;
const PALETTE = ["#E8930C", "#4A6FA5", "#2A9D8F", "#7B6CB0", "#C46A86", "#8A9A3B", "#4BA3C7", "#8892A0"];

type Row = Holding & { price: number | null; change: number | null; value: number | null; color: string };

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

  const ids = useMemo(
    () => state.holdings.map((h) => h.id).sort().join(","),
    [state.holdings],
  );

  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!ids || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const cache = { data: await fetchPrices(ids.split(",")), fetchedAt: Date.now() };
      setPrices(cache);
      savePrices(cache);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update prices.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [ids]);

  // Fetch when the app opens or the set of coins changes, unless the cache is fresh and complete.
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  useEffect(() => {
    const cache = pricesRef.current;
    const fresh = cache && Date.now() - cache.fetchedAt < 60_000;
    const complete = cache && ids.split(",").every((id) => !id || cache.data[id]);
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
      const p = prices?.data[h.id];
      const price = p?.[cur] ?? null;
      const change = p?.[`${cur}_24h_change`] ?? null;
      return { ...h, price, change, value: price === null ? null : price * h.amount, color: "" };
    });
    list.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    return list.map((r, i) => ({ ...r, color: PALETTE[Math.min(i, PALETTE.length - 1)] }));
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
    if (confirm(`Remove ${h.name} from your portfolio?`)) update((hs) => hs.filter((x) => x.id !== h.id));
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
      setNotice(`Restored ${restored.holdings.length} coin${restored.holdings.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  const importControl = (text: string) => (
    <label className="link">
      {text}
      <input type="file" accept="application/json,.json" className="visually-hidden" onChange={importFile} />
    </label>
  );

  if (state.holdings.length === 0) {
    return (
      <main className="app">
        <header className="top">
          <span className="brand">Folio</span>
        </header>
        <section className="welcome">
          <h1>What do you hold?</h1>
          <p>
            Add each coin and the amount you own. Amounts stay on this device. Only coin names are sent out, to
            look up prices.
          </p>
        </section>
        <AddHolding existingIds={[]} onAdd={addHolding} />
        <footer className="footer">
          {importControl("Restore from a backup file")}
          {notice && <span role="status">{notice}</span>}
        </footer>
      </main>
    );
  }

  let status: string;
  if (loading) status = "Updating prices…";
  else if (error && prices) status = `${error} Showing prices from ${timeAgo(prices.fetchedAt)}.`;
  else if (error) status = error;
  else if (!online && prices) status = `Offline. Showing prices from ${timeAgo(prices.fetchedAt)}.`;
  else if (prices) status = `Prices updated ${timeAgo(prices.fetchedAt)}`;
  else status = "";

  const valued = rows.filter((r) => r.value);
  const allocLabel = valued.map((r) => `${r.symbol} ${((r.value! / total) * 100).toFixed(0)}%`).join(", ");

  return (
    <main className="app">
      <header className="top">
        <span className="brand">Folio</span>
        <div className="toggle" role="group" aria-label="Currency">
          {(["usd", "cop"] as const).map((c) => (
            <button key={c} type="button" aria-pressed={cur === c} onClick={() => setCurrency(c)}>
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <section className="summary" aria-live="polite">
        <p className="total">{prices ? formatMoney(total, cur) : "—"}</p>
        {totalChange !== null && (
          <p className={`change ${totalChange >= 0 ? "up" : "down"}`}>{formatPercent(totalChange)} in 24 h</p>
        )}
        {total > 0 && (
          <div className="alloc" role="img" aria-label={`Allocation: ${allocLabel}`}>
            {valued.map((r) => (
              <span key={r.id} style={{ flexGrow: r.value!, background: r.color }} />
            ))}
          </div>
        )}
        <p className="status">
          <span className={error ? "error" : undefined}>{status}</span>
          <button type="button" className="link" onClick={refresh} disabled={loading || !online}>
            Refresh
          </button>
        </p>
      </section>

      <ul className="holdings">
        {rows.map((r) => (
          <li key={r.id} className="row">
            <span className="dot" style={{ background: r.value ? r.color : "var(--line)" }} aria-hidden />
            <div className="coin">
              <strong>{r.name}</strong>
              <span>
                {formatAmount(r.amount)} {r.symbol}
              </span>
            </div>
            {editing ? (
              <div className="edit">
                <AmountInput holding={r} onSave={(n) => setAmount(r.id, n)} />
                <button type="button" className="link danger" onClick={() => remove(r)}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="value">
                <strong>{r.value === null ? "No price yet" : formatMoney(r.value, cur)}</strong>
                {r.price !== null && (
                  <span>
                    {formatMoney(r.price, cur)}
                    {r.change !== null && (
                      <em className={r.change >= 0 ? "up" : "down"}> {formatPercent(r.change)}</em>
                    )}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <AddHolding existingIds={state.holdings.map((h) => h.id)} onAdd={addHolding} onCancel={() => setAdding(false)} />
      ) : (
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            Add coin
          </button>
          <button type="button" className="btn" onClick={() => setEditing((v) => !v)}>
            {editing ? "Done" : "Edit amounts"}
          </button>
        </div>
      )}

      <footer className="footer">
        <button type="button" className="link" onClick={() => exportBackup(state)}>
          Export backup
        </button>
        {importControl("Import backup")}
        {notice && <span role="status">{notice}</span>}
      </footer>
    </main>
  );
}

function AmountInput({ holding, onSave }: { holding: Holding; onSave: (n: number) => void }) {
  const [draft, setDraft] = useState(() => amountToInput(holding.amount));
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    const n = parseAmount(draft);
    if (n === null || n <= 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (n !== holding.amount) onSave(n);
  };

  return (
    <input
      className="field"
      inputMode="decimal"
      aria-label={`Amount of ${holding.name}`}
      aria-invalid={invalid || undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
