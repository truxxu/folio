import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { fetchPrices, searchCoins, searchStocks, stockFamilyLabel, stockTicker } from "./api";
import { formatMoney, parseAmount } from "./format";
import { coinColor, Tile } from "./Tile";
import {
  FIATS,
  type CoinSearchResult,
  type Currency,
  type Fiat,
  type Holding,
  type HoldingKind,
  type PriceCache,
  type PriceMap,
} from "./types";
import { FIAT_NAMES, fiatPrice } from "./value";

interface Props {
  variant: "sheet" | "inline";
  existingIds: string[];
  currency: Currency;
  prices?: PriceCache | null;
  onAdd: (holding: Holding) => void;
  onCancel?: () => void;
}

type FormProps = Omit<Props, "onCancel">;

const KINDS: [HoldingKind, string][] = [
  ["crypto", "Crypto"],
  ["stock", "Stocks"],
  ["cash", "Cash"],
  ["account", "Account"],
];

// What differs between the crypto and stock forms. Both are CoinGecko coins underneath.
const MARKETS = {
  crypto: {
    search: searchCoins,
    label: "Coin",
    placeholder: "Search by name or ticker",
    noun: "coins",
    change: "Change coin",
    // Shortcuts on the first-run screen; they skip the search request.
    quick: [
      { id: "bitcoin", symbol: "BTC", name: "Bitcoin", market_cap_rank: null },
      { id: "ethereum", symbol: "ETH", name: "Ethereum", market_cap_rank: null },
      { id: "solana", symbol: "SOL", name: "Solana", market_cap_rank: null },
    ] as CoinSearchResult[],
  },
  stock: {
    search: searchStocks,
    label: "Stock or ETF",
    placeholder: "Search by ticker, e.g. SPY",
    noun: "tokenized stocks",
    change: "Change stock",
    quick: [
      { id: "sp500-xstock", symbol: "SPYX", name: "SP500 xStock", market_cap_rank: null },
      { id: "nasdaq-xstock", symbol: "QQQX", name: "Nasdaq xStock", market_cap_rank: null },
      { id: "vanguard-s-p-500-etf-rstock", symbol: "RVOO", name: "Vanguard S&P 500 ETF rStock", market_cap_rank: null },
    ] as CoinSearchResult[],
  },
};

// Symbol shown for a search result: the real ticker for tokenized stocks (SPYX → SPY).
const tickerOf = (kind: "crypto" | "stock", c: CoinSearchResult) =>
  kind === "stock" ? stockTicker(c) : c.symbol.toUpperCase();

export function AddHolding({ onCancel, ...props }: Props) {
  const [kind, setKind] = useState<HoldingKind>("crypto");

  const body = (
    <>
      <div className="toggle kind-toggle mono" role="group" aria-label="Type">
        {KINDS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      {kind === "crypto" || kind === "stock" ? (
        <MarketForm key={kind} kind={kind} {...props} />
      ) : (
        <FiatForm key={kind} kind={kind} {...props} />
      )}
    </>
  );

  if (props.variant === "inline") return <div className="add-inline">{body}</div>;
  return <Sheet onClose={onCancel}>{body}</Sheet>;
}

// Crypto and tokenized stocks: search CoinGecko, pick one, enter an amount.
function MarketForm({
  kind,
  variant,
  existingIds,
  currency,
  prices,
  onAdd,
}: FormProps & { kind: "crypto" | "stock" }) {
  const m = MARKETS[kind];
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
        setResults(await m.search(q, ctrl.signal));
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
  }, [query, picked, m]);

  // Price of the picked coin, for the "≈ value" estimate. Uses cached prices when we have them,
  // otherwise one request for just this coin. Without a price the estimate is simply hidden.
  const pricesRef = useRef(prices);
  pricesRef.current = prices;
  useEffect(() => {
    const known = picked ? pricesRef.current?.data[picked.id] : undefined;
    setQuote(known ?? null);
    if (!picked || known) return;
    const ctrl = new AbortController();
    fetchPrices([picked.id], pricesRef.current?.rates, ctrl.signal)
      .then(({ data }) => setQuote(data[picked.id] ?? null))
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
    onAdd({ kind, id: picked.id, symbol: tickerOf(kind, picked), name: picked.name, amount: n });
  }

  const showEmpty = query.trim().length >= 2 && !searching && !searchError && results.length === 0;
  const price = quote?.[currency] ?? null;
  const symbol = picked ? tickerOf(kind, picked) : "";

  if (!picked) {
    return (
      <div className="add-step">
        <label htmlFor="coin-search" className="label">
          {m.label}
        </label>
        <input
          id="coin-search"
          className="field search"
          placeholder={m.placeholder}
          autoComplete="off"
          autoFocus={variant === "sheet"}
          data-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {variant === "inline" && !query.trim() && (
          <div className="chips mono">
            {m.quick.map((c) => (
              <button key={c.id} type="button" disabled={existingIds.includes(c.id)} onClick={() => setPicked(c)}>
                + {tickerOf(kind, c)}
              </button>
            ))}
          </div>
        )}
        {kind === "stock" && !query.trim() && (
          <p className="hint">Prices come from tokenized versions of the stock and may differ slightly from the exchange.</p>
        )}
        {searching && <p className="hint">Searching…</p>}
        {searchError && <p className="hint error">{searchError}</p>}
        {showEmpty && <p className="hint">No {m.noun} match “{query.trim()}”.</p>}
        {results.length > 0 && (
          <ul className="results">
            {results.map((c) => {
              const added = existingIds.includes(c.id);
              return (
                <li key={c.id}>
                  <button type="button" disabled={added} onClick={() => setPicked(c)}>
                    <Tile symbol={tickerOf(kind, c)} />
                    <span className="result-name">
                      <strong>{c.name}</strong> <span className="mono muted">{tickerOf(kind, c)}</span>
                    </span>
                    <span className="mono muted">
                      {added
                        ? "Already added"
                        : kind === "stock"
                          ? stockFamilyLabel(c.id)
                          : c.market_cap_rank
                            ? `#${c.market_cap_rank}`
                            : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form className="add-step" onSubmit={submit} noValidate>
      <div className="picked">
        <Tile symbol={symbol} color={coinColor(existingIds.length)} />
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
          {m.change}
        </button>
      </div>
      <AmountField
        value={amount}
        onChange={(v) => {
          setAmount(v);
          setAmountError(null);
        }}
        error={amountError}
        unit={symbol}
        price={price}
        currency={currency}
      />
      <div className="spacer" />
      <button type="submit" className="btn primary block tall">
        Add {symbol}
      </button>
    </form>
  );
}

// Cash (one per currency) and named account balances. Their value comes from the fiat rates.
function FiatForm({
  kind,
  variant,
  existingIds,
  currency,
  prices,
  onAdd,
}: FormProps & { kind: "cash" | "account" }) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [fiat, setFiat] = useState<Fiat | null>(null);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  const held = (f: Fiat) => kind === "cash" && existingIds.includes(`cash:${f}`);
  const allHeld = FIATS.every(held);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!fiat) return;
    const label = name.trim();
    const n = parseAmount(amount);
    if (kind === "account" && !label) setNameError("Give the account a name, like Savings");
    if (n === null || n <= 0) setAmountError("Enter an amount greater than zero, like 1500");
    if ((kind === "account" && !label) || n === null || n <= 0) return;
    onAdd({
      kind,
      id: kind === "cash" ? `cash:${fiat}` : `account:${crypto.randomUUID()}`,
      fiat,
      symbol: fiat.toUpperCase(),
      name: kind === "cash" ? FIAT_NAMES[fiat] : label,
      amount: n,
    });
  }

  return (
    <form className="add-step" onSubmit={submit} noValidate>
      {kind === "account" && (
        <>
          <label htmlFor="account-name" className="label">
            Account name
          </label>
          <input
            id="account-name"
            className="field search"
            placeholder="e.g. Bancolombia savings"
            autoComplete="off"
            autoFocus={variant === "sheet"}
            data-autofocus
            value={name}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "name-error" : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
          {nameError && (
            <p id="name-error" className="hint error">
              {nameError}
            </p>
          )}
        </>
      )}
      <p id="fiat-label" className={`label${kind === "account" ? " gap" : ""}`}>
        Currency
      </p>
      <div className="chips mono pick" role="group" aria-labelledby="fiat-label">
        {FIATS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={fiat === f}
            disabled={held(f)}
            title={held(f) ? "Already added" : undefined}
            onClick={() => setFiat(f)}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      {allHeld && <p className="hint">You already hold cash in every currency. Change amounts under Edit.</p>}
      {fiat && (
        <AmountField
          value={amount}
          onChange={(v) => {
            setAmount(v);
            setAmountError(null);
          }}
          error={amountError}
          unit={fiat.toUpperCase()}
          price={fiatPrice(prices?.rates, fiat, currency)}
          currency={currency}
        />
      )}
      <div className="spacer" />
      <button type="submit" className="btn primary block tall" disabled={!fiat}>
        {kind === "cash" ? `Add ${fiat ? fiat.toUpperCase() + " " : ""}cash` : "Add account"}
      </button>
    </form>
  );
}

// The big amount input, with an "≈ value" estimate when we know the price.
function AmountField({
  value,
  onChange,
  error,
  unit,
  price,
  currency,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  unit: string;
  price: number | null;
  currency: Currency;
}) {
  const parsed = parseAmount(value);
  return (
    <>
      <label htmlFor="amount" className="label amount-label">
        How much you hold
      </label>
      <div className="big-amount" aria-invalid={error ? true : undefined}>
        <input
          id="amount"
          className="mono"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder="0.00"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "amount-error" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="mono unit" aria-hidden>
          {unit}
        </span>
      </div>
      {error ? (
        <p id="amount-error" className="hint error">
          {error}
        </p>
      ) : (
        price !== null &&
        parsed !== null &&
        parsed > 0 &&
        unit !== currency.toUpperCase() && <p className="hint mono">≈ {formatMoney(parsed * price, currency)}</p>
      )}
    </>
  );
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
          <h2 id="sheet-title">Add</h2>
          <button type="button" className="text-btn" onClick={() => ref.current?.close()}>
            Cancel
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
