# Folio

A small, private crypto portfolio tracker. Installable as a PWA, works offline, hosted for free on GitHub Pages.

- Enter coins and amounts once; they're saved in `localStorage` on your device.
- Prices come from CoinGecko's public API (USD and COP, with 24 h change).
- The last prices are cached, so the app opens offline and shows when they're from.
- Export/import a JSON backup to move between devices or recover data.

## Run locally

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

1. Create a repo and push this project to the `main` branch.
2. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` builds and deploys. The site appears at `https://<username>.github.io/<repo>/`.

The workflow sets the base path to `/<repo>/` automatically. If the repo is named `<username>.github.io`, edit `BASE_PATH` in `.github/workflows/deploy.yml` to `/`.

## Install on your phone

- **iOS (Safari):** Share → Add to Home Screen. Do this rather than using it in a tab: Safari can clear storage for sites not visited for about 7 days, but home-screen apps are exempt.
- **Android (Chrome):** menu → Install app.

## Project layout

```
src/
  App.tsx         portfolio view, refresh logic, backup import/export
  AddHolding.tsx  coin search + amount entry
  api.ts          CoinGecko calls
  storage.ts      localStorage, backup parsing
  format.ts       money/amount formatting and parsing
  types.ts
public/           icons
vite.config.ts    PWA manifest and service worker config
```

## Notes

- CoinGecko's free API is rate-limited. The app refreshes on open and every 5 minutes while visible.
- To add another fiat currency, add it to `vs_currencies` in `api.ts`, extend the `Currency` type, and add a button in the header toggle.
