import type { CSSProperties } from "react";

// Coin colours are theme tokens (--c1 … --c8 in styles.css) so they follow light/dark mode.
const PALETTE_SIZE = 8;
export const coinColor = (i: number) => `var(--c${Math.min(i, PALETTE_SIZE - 1) + 1})`;

// Rounded square with the ticker, tinted in the coin's colour. Without a colour it's neutral grey.
export function Tile({ symbol, color }: { symbol: string; color?: string }) {
  return (
    <span className={`tile mono${color ? "" : " neutral"}`} style={{ "--coin": color } as CSSProperties} aria-hidden>
      {symbol.toUpperCase().slice(0, 4)}
    </span>
  );
}
