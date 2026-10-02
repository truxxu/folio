# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev`: Vite dev server
- `npm run build`: type-check (`tsc -b`) and then a production build to `dist/`. This is the only check in the repo. There is no linter and no test suite.
- `npm run preview`: serve the production build. Use this, not `dev`, to test the service worker and offline behavior.

## What this is

Folio is a client-only React 19 + TypeScript + Vite PWA that tracks a crypto portfolio. It has no backend. Holdings live in `localStorage`, prices come straight from CoinGecko's free public API in the browser, and the site deploys to GitHub Pages.

## Architecture

- **All state lives in `App.tsx`.** There is no router and no state library. `App` is a lock gate: it renders `Lock.tsx` while the data is encrypted, and `Portfolio` (the real app) once there's a session. `AppState` (holdings + selected currency + `hideBalances`) and the price cache are saved to `localStorage` on every change through `persist` in `storage.ts`. The other components are `AddHolding.tsx` (add bottom sheet with Crypto/Cash/Account tabs, or inline on first run), `Tile.tsx` (coin ticker tile + `coinColor`), and `Backup.tsx` (`ImportBackup` file picker that handles encrypted files, and `NewSecretForm` for new passwords/passcodes). Theme colors, including the coin palette `--c1…--c8`, are CSS variables in `styles.css`: dark by default, light under `prefers-color-scheme: light`.
- **Two `localStorage` keys, both versioned:** `folio:state:v1` holds user data and `folio:prices:v1` holds the last `PriceCache`. If you change the shape of `AppState`, keep `loadState` and `parseBackup` in `storage.ts` working with old data and old backup files. Users' only copy of their data is on their device or in an exported JSON backup. `folio:lock:v1` only counts wrong passcode attempts for throttling.
- **Passcode lock** (`crypto.ts`): with a passcode set, both keys hold a `Sealed` blob (PBKDF2-SHA256 600k → AES-GCM) instead of JSON, and `loadState` returns `null`. The derived key (`Vault`) only lives in memory. A reload, or more than `LOCK_AFTER_MS` in the background, means unlocking again. All writes go through one promise queue in `storage.ts`, so an async encryption can't overwrite a newer write. A forgotten passcode can't be recovered: the lock screen only offers restoring a backup or erasing.
- **Backups** are plain JSON, or `{ folio: "backup", ...Sealed }` when exported with a password. `parseBackup` returns `{ state }` or `{ sealed }`, and `openBackup` decrypts and validates the second.
- **Privacy on screen:** `hideBalances` masks money values, amounts and allocation shares with `MASK` (prices, % changes and fiat rates stay visible). The eye button reveals them until the app goes to the background. Leaving the app also adds `html.shielded`, which blurs everything for the app-switcher snapshot.
- **Offline works in two layers:** the Workbox service worker (configured in `vite.config.ts`) precaches the app shell, and the app caches prices itself in `localStorage`. CoinGecko responses are not cached by the service worker.
- **Network privacy:** `index.html` sets `no-referrer`, and a build-only plugin in `vite.config.ts` adds a CSP. **A new API host must be added to `connect-src`**, or requests to it are blocked in production only (not in `dev`). `fetchPrices` adds `DECOY_IDS` to every price request so CoinGecko doesn't see exactly which coins are held.
- **Price refresh logic** (`App.tsx`): prices are fetched when the app opens or the set of coin ids changes, unless the cache is under 60 s old and has every coin. After that, a 30 s check fetches again only if the page is visible, the device is online, and the prices are over 5 min old. Refs (`pricesRef`, `refreshRef`, `inFlight`) keep the intervals stable and stop overlapping requests. Be careful with this, because the free CoinGecko API is rate-limited (it returns 429).
- **`PriceMap` keys** follow CoinGecko's format: `prices.data[id][currency]` and `prices.data[id][`${currency}_24h_change`]`.
- **Holding kinds** (`kind` on `Holding`, missing = `"crypto"` for data saved before it existed): `crypto` (id is the CoinGecko id), `stock` (id is the CoinGecko id of a *tokenized* stock/ETF, priced exactly like crypto), `cash` (id `cash:<fiat>`, one per currency) and `account` (id `account:<uuid>`, user-named, several allowed). Cash and accounts carry a `fiat` (`usd | eur | cop`), which is separate from the display `currency` (`usd | cop`). The home screen groups holdings by kind with a subtotal each. `holdingPrice` in `value.ts` turns any holding into a price in the display currency, and App and `AddHolding` both use it.
- **Stocks/ETFs are tokenized stocks on CoinGecko** (xStock, Ondo, Robinhood, rStock…), because Yahoo Finance has no CORS and keyed APIs (Finnhub, Twelve Data) can't ship a key in a public build. `STOCK_FAMILIES` in `api.ts` filters `/search` results by id and turns token symbols back into tickers (`SPYX` → `SPY`, stored as `symbol`). `isMarket` in `types.ts` means "priced by CoinGecko" (crypto + stock).
- **Fiat rates come from yadio.io, not CoinGecko**: `fetchPrices` in `api.ts` makes one `/exrates/USD` call and stores `{ usd: 1, cop, eur }` (units per USD) in `PriceCache.rates`. It derives COP crypto prices from that (`cop` = `usd × rate`, `cop_24h_change` = `usd_24h_change`), and cash/accounts are valued with it (no 24h change). If yadio fails, those rates are just missing and USD still works. When there are no crypto holdings, the CoinGecko call is skipped. A cache without `rates` counts as incomplete and is refetched.
- **Adding a fiat currency** takes changes in three places: `vs_currencies` in `api.ts`, the `Currency` type in `types.ts`, and the header toggle in `App.tsx`. Also check `formatMoney` in `format.ts` (locale and decimal places) and `parseBackup` (it currently only accepts `"cop"`, and anything else becomes `"usd"`). A currency you can only *hold* (like EUR) just needs adding to `Fiat`/`FIATS` in `types.ts` and `FIAT_NAMES` in `value.ts`.
- **`format.ts`** handles number parsing and display. `parseAmount` accepts both `,` and `.` as the decimal separator, because the app is used in Colombia (COP, `es-CO`).
- **The base path** comes from the `BASE_PATH` env var (default `/`). The deploy workflow sets it to `/<repo-name>/` for GitHub Pages. Asset references must stay relative to the base, so don't hardcode leading-slash paths.

## Deployment

Every push to `main` builds and deploys to GitHub Pages through `.github/workflows/deploy.yml` (Node 22, `npm ci`).
