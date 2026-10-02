import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type { Sealed } from "./crypto";
import { openBackup, parseBackup } from "./storage";
import type { AppState } from "./types";

// A file picker for backups. Password-protected files ask for their password in an inline form.
export function ImportBackup({
  className,
  children,
  onRestore,
  onError,
}: {
  className: string;
  children: ReactNode;
  onRestore: (state: AppState) => void;
  onError: (message: string) => void;
}) {
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSealed(null);
    try {
      const parsed = parseBackup(await file.text());
      if ("state" in parsed) onRestore(parsed.state);
      else {
        setSealed(parsed.sealed);
        setPassword("");
        setWrong(false);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!sealed || busy) return;
    setBusy(true);
    try {
      const state = await openBackup(password, sealed);
      setSealed(null);
      onRestore(state);
    } catch {
      setWrong(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className={className}>
        {children}
        <input type="file" accept="application/json,.json" className="visually-hidden" onChange={pick} />
      </label>
      {sealed && (
        <form className="secret-form" onSubmit={submit}>
          <label className="label" htmlFor="backup-password">
            This backup has a password
          </label>
          <input
            id="backup-password"
            className="field secret"
            type="password"
            autoComplete="off"
            autoFocus
            value={password}
            aria-invalid={wrong || undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setWrong(false);
            }}
          />
          {wrong && <p className="hint error mono">Wrong password.</p>}
          <div className="secret-actions">
            <button type="button" className="text-btn" onClick={() => setSealed(null)}>
              Cancel
            </button>
            <button type="submit" className="pill-btn" disabled={!password || busy}>
              {busy ? "Opening…" : "Restore"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

// Asks for a new password or passcode twice. With `optional`, an empty one is allowed.
export function NewSecretForm({
  label,
  minLength,
  optional = false,
  hint,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  label: string;
  minLength: number;
  optional?: boolean;
  hint?: ReactNode;
  submitLabel: (secret: string) => string;
  onSubmit: (secret: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [secret, setSecret] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);

  const tooShort = secret.length > 0 && secret.length < minLength;
  const mismatch = secret.length > 0 && repeat.length > 0 && secret !== repeat;
  const ok = (optional && !secret) || (secret.length >= minLength && secret === repeat);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    try {
      await onSubmit(secret);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="secret-form" onSubmit={submit}>
      <label className="label" htmlFor="new-secret">
        {label}
      </label>
      <input
        id="new-secret"
        className="field secret"
        type="password"
        autoComplete="new-password"
        autoFocus
        value={secret}
        aria-invalid={tooShort || undefined}
        onChange={(e) => setSecret(e.target.value)}
      />
      {secret && (
        <>
          <label className="label" htmlFor="repeat-secret">
            Repeat it
          </label>
          <input
            id="repeat-secret"
            className="field secret"
            type="password"
            autoComplete="new-password"
            value={repeat}
            aria-invalid={mismatch || undefined}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </>
      )}
      {tooShort ? (
        <p className="hint error mono">At least {minLength} characters.</p>
      ) : mismatch ? (
        <p className="hint error mono">They don't match.</p>
      ) : (
        hint && <p className="hint mono">{hint}</p>
      )}
      <div className="secret-actions">
        <button type="button" className="text-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="pill-btn" disabled={!ok || busy}>
          {busy ? "Working…" : submitLabel(secret)}
        </button>
      </div>
    </form>
  );
}
