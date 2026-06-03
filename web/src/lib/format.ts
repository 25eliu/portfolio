export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export const signedUsd = (n: number) => `${n >= 0 ? "+" : ""}${usd(n)}`;

export const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

/** Unsigned percentage (e.g. allocation weights). */
export const pctRaw = (n: number) => `${n.toFixed(1)}%`;

export const pnlClass = (n: number | null | undefined) =>
  n == null ? "text-text-secondary" : n >= 0 ? "text-pos" : "text-neg";

/** Whether P&L figures are shown in dollars or as a percentage. Global UI toggle. */
export type PnlMode = "usd" | "pct";

/** Total P&L as a percentage of cost basis. Null when there's no known basis. */
export const totalPnLPct = (totalPnL: number, costValue: number) =>
  costValue > 0 ? (totalPnL / costValue) * 100 : null;

/** Day P&L as a percentage of the previous snapshot's equity. Null when unknown. */
export const dayPnLPct = (dayPnL: number | null, equity: number) => {
  if (dayPnL == null) return null;
  const prevEquity = equity - dayPnL;
  return prevEquity > 0 ? (dayPnL / prevEquity) * 100 : null;
};

/** Render Total P&L respecting the $/% display mode. "—" when % is unknowable. */
export const fmtTotalPnL = (totalPnL: number, costValue: number, mode: PnlMode) => {
  if (mode === "usd") return signedUsd(totalPnL);
  const p = totalPnLPct(totalPnL, costValue);
  return p == null ? "—" : pct(p);
};

/** Render Day P&L respecting the $/% display mode. "—" when unknown. */
export const fmtDayPnL = (dayPnL: number | null, equity: number, mode: PnlMode) => {
  if (mode === "usd") return dayPnL == null ? "—" : signedUsd(dayPnL);
  const p = dayPnLPct(dayPnL, equity);
  return p == null ? "—" : pct(p);
};

/** ISO datetime → "Jun 3, 12:13 AM" in the viewer's local time. */
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** "16:00" (24h) → "4:00 PM" for display. */
export const time12h = (hhmm: string) => {
  const [hRaw, mRaw] = hhmm.split(":");
  const h = Number(hRaw ?? 0);
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${(mRaw ?? "00").padStart(2, "0")} ${period}`;
};

/** Compact currency for axis ticks: $1.2k, $124k, $1.4M. */
export const compactUsd = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
};
