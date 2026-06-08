import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { TickerCall, TickerHistory } from "../../api/client.ts";
import { cn } from "../../lib/cn.ts";
import { Badge } from "../ui/Badge.tsx";
import { useViewInJournal } from "../../lib/journalFocus.tsx";
import { CALL_TONE } from "./inFlight.ts";

const fmtR = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);
const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);
const rTone = (x: number | null) => (x == null ? "text-text-muted" : x >= 0 ? "text-pos" : "text-neg");

// Resolved-outcome → tone: a hit is good, a stop is bad, expired is neutral, ambiguous is a caution.
const OUTCOME_TONE: Record<string, "pos" | "neg" | "neutral" | "warn"> = {
  target_hit: "pos", stop_hit: "neg", expired: "neutral", ambiguous_touch: "warn",
};
const OUTCOME_LABEL: Record<string, string> = {
  target_hit: "target hit", stop_hit: "stopped", expired: "expired", ambiguous_touch: "ambiguous",
};

/** A compact KPI cell matching the wiki's calibration strip. */
function MiniStat({ label, value, tone }: { label: ReactNode; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-2/50 p-2">
      <div className="text-[9px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={cn("tnum mt-0.5 text-[13px] font-semibold", tone ?? "text-text")}>{value}</div>
    </div>
  );
}

/** A `YYYY-MM-DD` (or ISO) date as a short "Jun 3" label. */
function shortDate(d: string): string {
  const date = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** One call in a ticker's timeline: when, direction, outcome/status, R, conviction, journal link. */
function CallLine({ call, ticker }: { call: TickerCall; ticker: string }) {
  const viewInJournal = useViewInJournal();
  const tone = call.resolved
    ? OUTCOME_TONE[call.outcome ?? ""] ?? "neutral"
    : CALL_TONE[call.status ?? ""] ?? "neutral";
  const label = call.resolved ? OUTCOME_LABEL[call.outcome ?? ""] ?? call.outcome : call.status;
  const r = call.resolved ? call.realizedR : call.unrealizedR;
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 text-[11px]">
      <span className="tnum w-12 shrink-0 text-text-muted">{shortDate(call.resolutionDate ?? call.createdAt)}</span>
      <span className={cn("w-12 shrink-0", call.side === "bullish" ? "text-pos" : "text-neg")}>{call.side}</span>
      <Badge tone={tone}>{label}</Badge>
      <span className={cn("tnum w-12 shrink-0", rTone(r))} title={call.resolved ? "realized R" : "live R"}>
        {fmtR(r)}
      </span>
      <span className="tnum hidden w-10 shrink-0 text-text-muted sm:inline" title="conviction">
        {pct(call.conviction)}
      </span>
      {viewInJournal && (
        <button
          onClick={() => viewInJournal(call.journalEntryId, ticker)}
          className="ml-auto shrink-0 text-[10px] text-text-muted transition-colors hover:text-accent"
        >
          journal →
        </button>
      )}
    </div>
  );
}

/** One ticker: a collapsed record line, expanding to a KPI strip + full call timeline. */
function TickerRow({ t }: { t: TickerHistory }) {
  const [open, setOpen] = useState(false);
  // Compact right-side record summary: resolved record if any, otherwise the live open count.
  const recordText = t.resolved > 0 ? `${t.wins}/${t.losses} W/L · ${t.resolved} resolved` : `${t.open} open`;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-2 py-2 text-left text-[12px] transition-colors hover:bg-surface-2/40"
      >
        <span className="font-medium text-text">{t.ticker}</span>
        <Badge tone="neutral">×{t.total}</Badge>
        <span className={cn("tnum font-medium", rTone(t.trackR))} title="average R (realized, else live)">
          {fmtR(t.trackR)}
        </span>
        <span className="ml-auto hidden text-[10px] text-text-muted sm:inline">{recordText}</span>
        {t.hitRate != null && (
          <span className="tnum text-[10px] text-text-secondary" title="hit rate">{pct(t.hitRate)} hit</span>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 px-2 pb-3">
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            <MiniStat label="Avg R" value={fmtR(t.trackR)} tone={rTone(t.trackR)} />
            <MiniStat label="Hit rate" value={pct(t.hitRate)} />
            <MiniStat label="W / L" value={`${t.wins} / ${t.losses}`} />
            <MiniStat label="Expectancy" value={fmtR(t.expectancyR)} />
            <MiniStat label="Open avg" value={fmtR(t.avgUnrealizedR)} />
            <MiniStat label="Calls" value={`${t.resolved}✓ ${t.open}○`} />
          </div>
          <div className="rounded-lg border border-hairline bg-surface/40">
            <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-1 text-[9px] uppercase tracking-wide text-text-muted">
              <span className="w-12">date</span>
              <span className="w-12">side</span>
              <span className="flex-1">outcome</span>
              <span>R · conv · journal</span>
            </div>
            <div className="divide-y divide-hairline border-t border-hairline">
              {t.calls.map((c) => (
                <CallLine key={c.forecastId} call={c} ticker={t.ticker} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Region 6 sub-panel — per-ticker track record across every resolved + open call, best avg R first. */
export function TickerHistoryPanel({ tickers }: { tickers: TickerHistory[] }) {
  const [open, setOpen] = useState(true);
  if (tickers.length === 0) return null;
  return (
    <div className="rounded-xl border border-hairline bg-surface-2/30">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2/40"
      >
        <span className="text-[11px] uppercase tracking-wide text-text-muted shrink-0">
          Track record · {tickers.length} tickers
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-text-muted">best avg R first · click a ticker</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-hairline px-1.5 pb-1">
          <div className="divide-y divide-hairline">
            {tickers.map((t) => (
              <TickerRow key={t.ticker} t={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
