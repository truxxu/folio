import type { Currency } from "./types";

function moneyFormat(value: number, currency: Currency): Intl.NumberFormat {
  const isCop = currency === "cop";
  const small = value !== 0 && Math.abs(value) < 1;
  return new Intl.NumberFormat(isCop ? "es-CO" : "en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: isCop ? 0 : 2,
    maximumFractionDigits: isCop ? (small ? 2 : 0) : small ? 6 : 2,
  });
}

// Stands in for money values and amounts while balances are hidden.
export const MASK = "••••";

export function formatMoney(value: number, currency: Currency): string {
  return moneyFormat(value, currency).format(value);
}

// Splits "$44,405.91" into ["$44,405", ".91"] so the cents can be styled separately.
export function formatMoneyParts(value: number, currency: Currency): [string, string] {
  const parts = moneyFormat(value, currency).formatToParts(value);
  const at = parts.findIndex((p) => p.type === "decimal");
  if (at === -1) return [parts.map((p) => p.value).join(""), ""];
  const join = (ps: Intl.NumberFormatPart[]) => ps.map((p) => p.value).join("");
  return [join(parts.slice(0, at)), join(parts.slice(at))];
}

export function formatAmount(amount: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(amount);
}

// Plain string for editing, never in exponent notation.
export function amountToInput(amount: number): string {
  return amount.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 10 });
}

export function formatPercent(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;
}

// Accepts "0.5", "0,5", "1,234.5". Returns null when it isn't a number.
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/\s/g, "");
  if (!s) return null;
  s = s.includes(",") && s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}
