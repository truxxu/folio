import { useEffect, useState, type FormEvent } from "react";
import { searchCoins } from "./api";
import { parseAmount } from "./format";
import type { CoinSearchResult, Holding } from "./types";

interface Props {
  existingIds: string[];
  onAdd: (holding: Holding) => void;
  onCancel?: () => void;
}

export function AddHolding({ existingIds, onAdd, onCancel }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CoinSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<CoinSearchResult | null>(null);
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

  return (
    <div className="panel">
      {!picked ? (
        <>
          <label htmlFor="coin-search">Coin</label>
          <input
            id="coin-search"
            className="field"
            placeholder="Search by name or ticker"
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
                      <span>
                        <strong>{c.name}</strong> <span className="muted">{c.symbol.toUpperCase()}</span>
                      </span>
                      <span className="muted">
                        {added ? "Already added" : c.market_cap_rank ? `#${c.market_cap_rank}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : (
        <form onSubmit={submit} noValidate>
          <p className="picked">
            <span>
              <strong>{picked.name}</strong> <span className="muted">{picked.symbol.toUpperCase()}</span>
            </span>
            <button
              type="button"
              className="link"
              onClick={() => {
                setPicked(null);
                setAmount("");
                setAmountError(null);
              }}
            >
              Change coin
            </button>
          </p>
          <label htmlFor="amount">How much you hold</label>
          <input
            id="amount"
            className="field"
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
          {amountError && (
            <p id="amount-error" className="hint error">
              {amountError}
            </p>
          )}
          <div className="actions">
            <button type="submit" className="btn primary">
              Add {picked.symbol.toUpperCase()}
            </button>
            {onCancel && (
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {!picked && onCancel && (
        <div className="actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
