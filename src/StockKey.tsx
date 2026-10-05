import { useState, type FormEvent } from "react";
import { validateKey } from "./api";

export const FINNHUB_SIGNUP = "https://finnhub.io/register";

// Asks for the user's Finnhub API key and checks it with one request before saving.
// `variant="sheet"` is the add sheet's Stocks tab; `"card"` sits in the Edit screen's settings card.
export function StockKeyForm({
  variant,
  onSave,
  onCancel,
}: {
  variant: "sheet" | "card";
  onSave: (key: string) => void;
  onCancel?: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const k = key.trim();
    if (!k || busy) return;
    setBusy(true);
    setError(null);
    try {
      await validateKey(k);
      onSave(k);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check the key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={variant === "sheet" ? "add-step" : "secret-form"} onSubmit={submit} noValidate>
      {variant === "sheet" && (
        <p className="hint key-intro">
          Stock prices come from Finnhub, which needs your own free API key.{" "}
          <a href={FINNHUB_SIGNUP} target="_blank" rel="noopener noreferrer">
            Get one at finnhub.io
          </a>
          , then paste it here. It stays on this device.
        </p>
      )}
      <label className="label" htmlFor="finnhub-key">
        Finnhub API key
      </label>
      <input
        id="finnhub-key"
        className="field secret mono"
        type="password"
        autoComplete="off"
        spellCheck={false}
        autoFocus={variant === "card"}
        data-autofocus
        value={key}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "finnhub-key-error" : undefined}
        onChange={(e) => {
          setKey(e.target.value);
          setError(null);
        }}
      />
      {error && (
        <p id="finnhub-key-error" className="hint error">
          {error}
        </p>
      )}
      {variant === "sheet" ? (
        <>
          <div className="spacer" />
          <button type="submit" className="btn primary block tall" disabled={!key.trim() || busy}>
            {busy ? "Checking…" : "Save key"}
          </button>
        </>
      ) : (
        <div className="secret-actions">
          <button type="button" className="text-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="pill-btn" disabled={!key.trim() || busy}>
            {busy ? "Checking…" : "Save key"}
          </button>
        </div>
      )}
    </form>
  );
}
