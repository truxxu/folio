import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ImportBackup } from "./Backup";
import { lockWaitUntil, recordUnlock, unlock, type Vault } from "./storage";
import type { AppState, PriceCache } from "./types";

export function Lock({
  brand,
  onUnlock,
  onReplace,
}: {
  brand: ReactNode;
  onUnlock: (session: { vault: Vault; state: AppState; prices: PriceCache | null }) => void;
  // Restoring a backup or erasing replaces the locked data and turns the passcode off.
  onReplace: (state: AppState | null) => void;
}) {
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);

  const waitUntil = lockWaitUntil();
  const wait = Math.ceil((waitUntil - now) / 1000);
  const waiting = wait > 0;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passcode || busy || waiting) return;
    setBusy(true);
    try {
      const session = await unlock(passcode);
      recordUnlock(true);
      onUnlock(session);
    } catch {
      recordUnlock(false);
      setWrong(true);
      setPasscode("");
      setNow(Date.now());
      setBusy(false);
    }
  }

  return (
    <main className="app first-run">
      <div className="glow" aria-hidden />
      <header className="top">{brand}</header>
      <section className="welcome">
        <h1>Locked</h1>
        <p>Enter your passcode to see your portfolio.</p>
      </section>
      <form className="secret-form lock-form" onSubmit={submit}>
        <label className="label" htmlFor="passcode">
          Passcode
        </label>
        <input
          id="passcode"
          className="field secret"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={passcode}
          aria-invalid={wrong || undefined}
          aria-describedby="passcode-hint"
          onChange={(e) => {
            setPasscode(e.target.value);
            setWrong(false);
          }}
        />
        <p id="passcode-hint" className={`hint mono${wrong || waiting ? " error" : ""}`} role="status">
          {waiting ? `Too many tries. Wait ${wait} s.` : wrong ? "Wrong passcode." : " "}
        </p>
        <button type="submit" className="btn primary block tall" disabled={!passcode || busy || waiting}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
      <footer className="restore">
        {forgot ? (
          <>
            <span>Your passcode can't be recovered. You can start again from a backup, or erase this device's data.</span>
            <ImportBackup
              className="text-btn mono"
              onRestore={(state) => {
                if (confirm("Replace the locked data with this backup? The passcode will be turned off.")) {
                  onReplace(state);
                }
              }}
              onError={setNotice}
            >
              ↑ Restore from a backup file
            </ImportBackup>
            <button
              type="button"
              className="text-btn mono danger"
              onClick={() => confirm("Erase all holdings on this device? This can't be undone.") && onReplace(null)}
            >
              Erase and start over
            </button>
          </>
        ) : (
          <button type="button" className="text-btn mono" onClick={() => setForgot(true)}>
            Forgot passcode?
          </button>
        )}
        {notice && <span role="status">{notice}</span>}
      </footer>
    </main>
  );
}
