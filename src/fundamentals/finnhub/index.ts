import type { Env } from "../../config/env.ts";

const BASE = "https://finnhub.io/api/v1";

/** Consensus label from recommendation-trend counts; null when unavailable. */
export async function finnhubAnalystRating(env: Env, symbol: string): Promise<string | null> {
  if (!env.FINNHUB_API_KEY) return null;
  try {
    const res = await fetch(`${BASE}/stock/recommendation?symbol=${symbol}&token=${env.FINNHUB_API_KEY}`);
    if (!res.ok) return null;
    const rows = (await res.json()) as { strongBuy?: number; buy?: number; hold?: number; sell?: number; strongSell?: number }[];
    const r = rows?.[0];
    if (!r) return null;
    const score = (r.strongBuy ?? 0) * 2 + (r.buy ?? 0) - (r.sell ?? 0) - (r.strongSell ?? 0) * 2;
    const total = (r.strongBuy ?? 0) + (r.buy ?? 0) + (r.hold ?? 0) + (r.sell ?? 0) + (r.strongSell ?? 0);
    if (total === 0) return null;
    const norm = score / total;
    return norm > 1 ? "Strong Buy" : norm > 0.25 ? "Buy" : norm > -0.25 ? "Hold" : norm > -1 ? "Sell" : "Strong Sell";
  } catch {
    return null;
  }
}

/** Next earnings date (YYYY-MM-DD) within ~90 days; null when unavailable. */
export async function finnhubNextEarnings(env: Env, symbol: string): Promise<string | null> {
  if (!env.FINNHUB_API_KEY) return null;
  try {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const res = await fetch(`${BASE}/calendar/earnings?from=${from}&to=${to}&symbol=${symbol}&token=${env.FINNHUB_API_KEY}`);
    if (!res.ok) return null;
    const j = (await res.json()) as { earningsCalendar?: { date?: string }[] };
    return j.earningsCalendar?.[0]?.date ?? null;
  } catch {
    return null;
  }
}
