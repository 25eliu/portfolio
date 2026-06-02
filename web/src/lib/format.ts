export const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export const signedUsd = (n: number) => `${n >= 0 ? "+" : ""}${usd(n)}`;

export const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

/** Unsigned percentage (e.g. allocation weights). */
export const pctRaw = (n: number) => `${n.toFixed(1)}%`;

export const pnlClass = (n: number | null | undefined) =>
  n == null ? "text-text-secondary" : n >= 0 ? "text-pos" : "text-neg";

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
