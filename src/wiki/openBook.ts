import type { ScoredForecast } from "../domain/index.ts";

export type OpenThesisStatus = "near_target" | "on_track" | "at_risk" | "near_stop";

export type OpenThesis = {
  ticker: string;
  side: "bullish" | "bearish";
  daysElapsed: number;
  horizonDays: number;
  referencePrice: number;
  currentPrice: number;
  movePct: number;
  toTarget: number;
  toStop: number;
  unrealizedR: number | null;
  status: OpenThesisStatus;
};

export type OpenBook = {
  theses: OpenThesis[];
  nearTarget: number;
  onTrack: number;
  atRisk: number;
  nearStop: number;
  avgUnrealizedR: number | null;
};

const daysBetween = (aIso: string, bIso: string): number => {
  const a = new Date(`${aIso.slice(0, 10)}T00:00:00.000Z`).getTime();
  const b = new Date(`${bIso.slice(0, 10)}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000));
};

/** Mark one forecast to the current price: progress toward target/stop, live R, and a status bucket. */
function progressFor(f: ScoredForecast, current: number) {
  const ref = f.referencePrice;
  const long = f.side === "bullish"; // bullish = upside bet (long math); bearish = downside (short math)
  const movePct = ref !== 0 ? (current - ref) / ref : 0;
  const targetSpan = long ? f.target - ref : ref - f.target;
  const stopSpan = long ? ref - f.stop : f.stop - ref;
  const toTarget = targetSpan !== 0 ? (long ? current - ref : ref - current) / targetSpan : 0;
  const toStop = stopSpan !== 0 ? (long ? ref - current : current - ref) / stopSpan : 0;
  const unrealizedR = stopSpan !== 0 ? (long ? current - ref : ref - current) / stopSpan : null;
  const status: OpenThesisStatus =
    toStop >= 0.8 ? "near_stop" : toTarget >= 0.8 ? "near_target" : (unrealizedR ?? 0) >= 0 ? "on_track" : "at_risk";
  return { movePct, toTarget, toStop, unrealizedR, status };
}

/** Mark every open forecast to its current price. Tickers absent from `priceBySymbol` are skipped. */
export function computeOpenBook(forecasts: ScoredForecast[], priceBySymbol: Map<string, number>, asOf: string): OpenBook {
  const theses: OpenThesis[] = [];
  for (const f of forecasts) {
    const current = priceBySymbol.get(f.ticker);
    if (current == null) continue;
    theses.push({
      ticker: f.ticker,
      side: f.side,
      referencePrice: f.referencePrice,
      currentPrice: current,
      daysElapsed: daysBetween(f.createdAt, asOf),
      horizonDays: daysBetween(f.createdAt, f.resolveAt),
      ...progressFor(f, current),
    });
  }
  const rs = theses.map((t) => t.unrealizedR).filter((r): r is number => r != null);
  return {
    theses,
    nearTarget: theses.filter((t) => t.status === "near_target").length,
    onTrack: theses.filter((t) => t.status === "on_track").length,
    atRisk: theses.filter((t) => t.status === "at_risk").length,
    nearStop: theses.filter((t) => t.status === "near_stop").length,
    avgUnrealizedR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
  };
}

const STATUS_RANK: Record<OpenThesisStatus, number> = { near_stop: 0, at_risk: 1, near_target: 2, on_track: 3 };
const pctSigned = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;

/** A compact blotter, sorted attention-first (near_stop/at_risk before on_track), with a summary line. */
export function renderOpenBook(book: OpenBook, asOf: string, maxRows = 12): string {
  if (book.theses.length === 0) return "";
  const ordered = [...book.theses].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.unrealizedR ?? 0) - (b.unrealizedR ?? 0),
  );
  const rows = ordered.slice(0, maxRows).map(
    (t) =>
      `${t.ticker} | ${t.side} | ${t.daysElapsed}/${t.horizonDays} | ${pctSigned(t.movePct)} | ${Math.round(t.toTarget * 100)}% | ${Math.round(t.toStop * 100)}% | ${t.unrealizedR == null ? "—" : t.unrealizedR.toFixed(2)} | ${t.status}`,
  );
  const avg = book.avgUnrealizedR == null ? "—" : book.avgUnrealizedR.toFixed(2);
  return [
    `OPEN BOOK (in-flight theses, marked ${asOf}) — are my live calls tracking? Columns: ticker | side | days | move | →target | →stop | R | status`,
    ...rows,
    `Summary: ${book.onTrack} on track, ${book.atRisk} at risk, ${book.nearStop} near stop, ${book.nearTarget} near target; avg unrealized ${avg}R.`,
  ].join("\n");
}
