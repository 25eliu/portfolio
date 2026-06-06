import type { ReactNode } from "react";
import { computePerformanceMetrics, type PerformanceMetrics } from "@shared/analysis/performance.ts";
import type { MarketSnapshot, Snapshot } from "../api/types.ts";
import { cn } from "../lib/cn.ts";
import { Term } from "./ui/Term.tsx";

const pct = (x: number | null, signed = false) =>
  x == null ? "—" : `${signed && x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

/**
 * Deterministic risk/performance analytics (Phase 6) over the equity history — max drawdown, Sharpe,
 * volatility, and excess return + beta vs SPY — for both books. Computed client-side from the snapshots
 * already fetched, via the shared pure `computePerformanceMetrics` (single source of truth with the server).
 */
export function RiskMetrics({ snapshots }: { snapshots?: { user: Snapshot[]; ai: Snapshot[]; spy: MarketSnapshot[] } }) {
  const spy = (snapshots?.spy ?? []).map((s) => ({ date: s.date, value: s.spyClose }));
  const toEquity = (snaps: Snapshot[]) => snaps.map((s) => ({ date: s.date, value: s.totalValue }));
  const user = computePerformanceMetrics(toEquity(snapshots?.user ?? []), spy);
  const ai = computePerformanceMetrics(toEquity(snapshots?.ai ?? []), spy);

  if (!user && !ai) return null;

  return (
    <div className="mt-5 grid grid-cols-1 gap-3 border-t border-hairline pt-4 sm:grid-cols-2">
      <Book label="You" tone="accent" m={user} />
      <Book label="AI paper" tone="pos" m={ai} />
    </div>
  );
}

function Book({ label, tone, m }: { label: string; tone: "accent" | "pos"; m: PerformanceMetrics | null }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", tone === "accent" ? "bg-accent" : "bg-pos")} />
        <span className="text-[11px] font-medium text-text-secondary">{label}</span>
        {m && <span className="text-[10px] text-text-muted">· {m.n + 1} snapshots</span>}
      </div>
      {m ? (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Total return" value={pct(m.totalReturn, true)} tone={m.totalReturn >= 0 ? "pos" : "neg"} />
          <Stat label={<Term k="sharpe">Sharpe</Term>} value={m.sharpe == null ? "—" : m.sharpe.toFixed(2)} />
          <Stat label={<Term k="maxDrawdown">Max drawdown</Term>} value={m.maxDrawdown ? `−${(m.maxDrawdown * 100).toFixed(1)}%` : "0%"} tone={m.maxDrawdown > 0 ? "neg" : undefined} />
          <Stat label={<Term k="annualizedVolatility">Volatility</Term>} value={pct(m.annualizedVolatility)} />
          <Stat label={<Term k="excessReturn">vs SPY</Term>} value={pct(m.excessReturn, true)} tone={m.excessReturn == null ? undefined : m.excessReturn >= 0 ? "pos" : "neg"} />
          <Stat label={<Term k="beta">Beta</Term>} value={m.beta == null ? "—" : m.beta.toFixed(2)} />
        </div>
      ) : (
        <p className="text-[11px] text-text-muted">Not enough history yet — needs a few snapshots.</p>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: ReactNode; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-2/50 p-2">
      <div className="text-[9px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={cn("tnum mt-0.5 text-[13px] font-semibold", tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-text")}>{value}</div>
    </div>
  );
}
