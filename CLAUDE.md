# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev`: Vite dev server
- `npm run build`: type-check (`tsc -b`) and then a production build to `dist/`. This is the only check in the repo. There is no linter and no test suite.
- `npm run preview`: serve the production build. Use this, not `dev`, to test the service worker and offline behavior.

## What this is

Folio is a client-only React 19 + TypeScript + Vite PWA that tracks a crypto portfolio. It has no backend. Holdings live in `localStorage`, prices come straight from CoinGecko's free public API in the browser, and the site deploys to GitHub Pages.

## Architecture

- **All state lives in `App.tsx`.** There is no router and no state library. `AppState` (holdings + selected currency) is saved to `localStorage` on every change. `AddHolding.tsx` (add-coin bottom sheet, or inline on first run) and `Tile.tsx` (coin ticker tile + `coinColor`) are the only other components. Theme colors, including the coin palette `--c1…--c8`, are CSS variables in `styles.css`: dark by default, light under `prefers-color-scheme: light`.
- **Two `localStorage` keys, both versioned:** `folio:state:v1` holds user data and `folio:prices:v1` holds the last `PriceCache`. If you change the shape of `AppState`, keep `loadState` and `parseBackup` in `storage.ts` working with old data and old backup files. Users' only copy of their data is on their device or in an exported JSON backup.
- **Offline works in two layers:** the Workbox service worker (configured in `vite.config.ts`) precaches the app shell, and the app caches prices itself in `localStorage`. CoinGecko responses are not cached by the service worker.
- **Price refresh logic** (`App.tsx`): prices are fetched when the app opens or the set of coin ids changes, unless the cache is under 60 s old and has every coin. After that, a 30 s check fetches again only if the page is visible, the device is online, and the prices are over 5 min old. Refs (`pricesRef`, `refreshRef`, `inFlight`) keep the intervals stable and stop overlapping requests. Be careful with this, because the free CoinGecko API is rate-limited (it returns 429).
- **`PriceMap` keys** follow CoinGecko's format: `prices.data[id][currency]` and `prices.data[id][`${currency}_24h_change`]`.
- **COP prices are derived, not fetched from CoinGecko** (it doesn't support COP): `fetchPrices` in `api.ts` gets the USD→COP rate from yadio.io (`/rate/COP/USD`) and fills in `cop` = `usd × rate` and `cop_24h_change` = `usd_24h_change`. If yadio fails, COP prices are just missing and USD still works.
- **Adding a fiat currency** takes changes in three places: `vs_currencies` in `api.ts`, the `Currency` type in `types.ts`, and the header toggle in `App.tsx`. Also check `formatMoney` in `format.ts` (locale and decimal places) and `parseBackup` (it currently only accepts `"cop"`, and anything else becomes `"usd"`).
- **`format.ts`** handles number parsing and display. `parseAmount` accepts both `,` and `.` as the decimal separator, because the app is used in Colombia (COP, `es-CO`).
- **The base path** comes from the `BASE_PATH` env var (default `/`). The deploy workflow sets it to `/<repo-name>/` for GitHub Pages. Asset references must stay relative to the base, so don't hardcode leading-slash paths.

## Deployment

Every push to `main` builds and deploys to GitHub Pages through `.github/workflows/deploy.yml` (Node 22, `npm ci`).
