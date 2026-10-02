import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// On GitHub Pages a project site lives at /<repo-name>/.
// The deploy workflow sets BASE_PATH automatically; locally it's "/".
const base = process.env.BASE_PATH ?? "/";

// Only the app's own files may run, and data may only be sent to the price APIs.
// Adding another API host means adding it to connect-src. Build-only: the dev server injects inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // React style={{ "--coin": … }} attributes
  "connect-src 'self' https://api.coingecko.com https://api.yadio.io",
  "img-src 'self' data:",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");

const csp = (): Plugin => ({
  name: "folio-csp",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
});

export default defineConfig({
  base,
  plugins: [
    react(),
    csp(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Folio",
        short_name: "Folio",
        description: "A private, offline-friendly crypto portfolio tracker.",
        display: "standalone",
        background_color: "#0A0E12",
        theme_color: "#0A0E12",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache the app shell so it opens offline.
        // Prices are cached in localStorage by the app itself.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
});
