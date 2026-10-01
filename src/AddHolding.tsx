import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { fetchPrices, searchCoins } from "./api";
import { formatMoney, parseAmount } from "./format";
import { coinColor, Tile } from "./Tile";
import type { CoinSearchResult, Currency, Holding, PriceMap } from "./types";

interface Props {
  variant: "sheet" | "inline";
  existingIds: string[];
  currency: Currency;
  prices?: PriceMap;
  onAdd: (holding: Holding) => void;
  onCancel?: () => void;
}

// Shortcuts on the first-run screen; they skip the search request.
const QUICK: CoinSearchResult[] = [
  { id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: null },
  { id: "ethereum", symbol: "ETH", name: "Ethereum", market_cap_rank: null },
  { id: "solana", symbol: "SOL", name: "Solana", market_cap_rank: null },
];

export function AddHolding({ variant, existingIds, currency, prices, onAdd, onCancel }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CoinSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<CoinSearchResult | null>(null);
  const [quote, setQuote] = useState<PriceMap[string] | null>(null);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || picked) {
      setResults([]);
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      setSearchError(null);
      try {
        setResults(await searchCoins(q, ctrl.signal));
      } catch (e) {
        if (!ctrl.signal.aborted) setSearchError(e instanceof Error ? e.message : "Search failed.");
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, picked]);

  // Price of the picked coin, for the "≈ value" estimate. Uses cached prices when we have them,
  // otherwise one request for just this coin. Without a price the estimate is simply hidden.
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  useEffect(() => {
    const known = picked ? pricesRef.current?.[picked.id] : undefined;
    setQuote(known ?? null);
    if (!picked || known) return;
    const ctrl = new AbortController();
    fetchPrices([picked.id], ctrl.signal)
      .then((data) => setQuote(data[picked.id] ?? null))
      .catch(() => {});
    return () => ctrl.abort();
  }, [picked]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    const n = parseAmount(amount);
    if (n === null || n <= 0) {
      setAmountError("Enter an amount greater than zero, like 0.25");
      return;
    }
    onAdd({ id: picked.id, symbol: picked.symbol.toUpperCase(), name: picked.name, amount: n });
  }

  const showEmpty = query.trim().length >= 2 && !searching && !searchError && results.length === 0;
  const price = quote?.[currency] ?? null;
  const parsed = parseAmount(amount);
  const symbol = picked?.symbol.toUpperCase() ?? "";

  const body = !picked ? (
    <div className="add-step">
      <label htmlFor="coin-search" className="label">
        Coin
      </label>
      <input
        id="coin-search"
        className="field search"
        placeholder="Search by name or ticker"
        autoComplete="off"
        autoFocus={variant === "sheet"}
        data-autofocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {variant === "inline" && !query.trim() && (
        <div className="chips mono">
          {QUICK.map((c) => (
            <button key={c.id} type="button" onClick={() => setPicked(c)}>
              + {c.symbol}
            </button>
          ))}
        </div>
      )}
      {searching && <p className="hint">Searching…</p>}
      {searchError && <p className="hint error">{searchError}</p>}
      {showEmpty && <p className="hint">No coins match “{query.trim()}”.</p>}
      {results.length > 0 && (
        <ul className="results">
          {results.map((c) => {
            const added = existingIds.includes(c.id);
            return (
              <li key={c.id}>
                <button type="button" disabled={added} onClick={() => setPicked(c)}>
                  <Tile symbol={c.symbol} />
                  <span className="result-name">
                    <strong>{c.name}</strong> <span className="mono muted">{c.symbol.toUpperCase()}</span>
                  </span>
                  <span className="mono muted">
                    {added ? "Already added" : c.market_cap_rank ? `#${c.market_cap_rank}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  ) : (
    <form className="add-step" onSubmit={submit} noValidate>
      <div className="picked">
        <Tile symbol={picked.symbol} color={coinColor(existingIds.length)} />
        <div className="coin">
          <strong>{picked.name}</strong>
          <span className="mono">
            {symbol}
            {price !== null && ` · ${formatMoney(price, currency)}`}
          </span>
        </div>
        <button
          type="button"
          className="text-btn accent mono"
          onClick={() => {
            setPicked(null);
            setAmount("");
            setAmountError(null);
          }}
        >
          Change coin
        </button>
      </div>
      <label htmlFor="amount" className="label amount-label">
        How much you hold
      </label>
      <div className="big-amount" aria-invalid={amountError ? true : undefined}>
        <input
          id="amount"
          className="mono"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder="0.00"
          value={amount}
          aria-invalid={amountError ? true : undefined}
          aria-describedby={amountError ? "amount-error" : undefined}
          onChange={(e) => {
            setAmount(e.target.value);
            setAmountError(null);
          }}
        />
        <span className="mono unit" aria-hidden>
          {symbol}
        </span>
      </div>
      {amountError ? (
        <p id="amount-error" className="hint error">
          {amountError}
        </p>
      ) : (
        price !== null &&
        parsed !== null &&
        parsed > 0 && <p className="hint mono">≈ {formatMoney(parsed * price, currency)}</p>
      )}
      <div className="spacer" />
      <button type="submit" className="btn primary block tall">
        Add {symbol}
      </button>
    </form>
  );

  if (variant === "inline") return <div className="add-inline">{body}</div>;
  return <Sheet onClose={onCancel}>{body}</Sheet>;
}

// Bottom sheet built on a modal <dialog>: focus trap, Esc to close and a backdrop for free.
function Sheet({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <div className="sheet-body">
        <span className="handle" aria-hidden />
        <div className="sheet-head">
          <h2 id="sheet-title">Add coin</h2>
          <button type="button" className="text-btn" onClick={() => ref.current?.close()}>
            Cancel
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
