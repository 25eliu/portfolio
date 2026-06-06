import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import type { AiInsight } from "../api/client.ts";
import type { Action, ForecastOutcome, JournalEntry, OutcomeKind } from "../api/types.ts";
import { useJournal, useJournalDay, useJournalDays, useJournalEntry, useMarketViewDay } from "../api/hooks.ts";
import { cn } from "../lib/cn.ts";
import { usd } from "../lib/format.ts";
import { stanceTone } from "../lib/stance.ts";
import { Badge } from "./ui/Badge.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";
import { Term } from "./ui/Term.tsx";
import { DeliberationPanel, CalibrationChain } from "./Reasoning.tsx";

/** Format an ISO calendar date (YYYY-MM-DD) as a readable day header, e.g. "Mon, Jun 2 2026". */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

const ACTION_TONE: Record<Action, "pos" | "neg" | "neutral" | "accent"> = {
  ADD: "pos",
  BUY: "pos",
  TRIM: "neg",
  SELL: "neg",
  HOLD: "neutral",
  WATCH: "accent",
  PASS: "neutral",
};

const OUTCOME_META: Record<OutcomeKind, { tone: "pos" | "neg" | "neutral" | "warn"; label: string }> = {
  target_hit: { tone: "pos", label: "target hit" },
  stop_hit: { tone: "neg", label: "stop hit" },
  expired: { tone: "neutral", label: "expired" },
  ambiguous_touch: { tone: "warn", label: "ambiguous" },
};

/** Format a fraction (0.0123) as a signed percent ("+1.2%"). */
function pct(x: number): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
}

/**
 * Region 4 — the typed journal. Lists every recommendation persisted from each run (scored or not)
 * straight from the database, never from LLM recall. Optionally filtered to one ticker (e.g. when a
 * recommendation card links here). Each row expands to its preserved thesis/prediction/citations and,
 * for scored calls, the forecast contract resolution will grade against.
 */
export function Journal({
  ticker,
  onClearFilter,
}: {
  ticker?: string;
  onClearFilter?: () => void;
}) {
  return (
    <div className="card p-6">
      <div className="mb-5 flex items-center gap-2">
        <p className="text-sm font-medium text-text-secondary">Journal</p>
        {ticker && (
          <button
            onClick={onClearFilter}
            className="flex items-center gap-1 rounded border border-hairline bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-text-secondary hover:text-text"
          >
            {ticker} <X className="h-3 w-3" />
          </button>
        )}
        <span className="ml-auto text-[11px] text-text-muted">
          {ticker ? "every call for this ticker" : "by day — click a day to see that day's calls"}
        </span>
      </div>

      {ticker ? <TickerJournal ticker={ticker} /> : <DayGroupedJournal />}
    </div>
  );
}

/** Default view: a compact list of days; click a day to reveal that day's calls. */
function DayGroupedJournal() {
  const days = useJournalDays();
  const rows = days.data?.days ?? [];

  if (days.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline p-8 text-center text-[12px] text-text-muted">
        No journal entries yet — run the analysis to start recording recommendations.
      </div>
    );
  }
  return (
    <div className="divide-y divide-hairline">
      {rows.map((d, i) => (
        <DayGroup key={d.date} day={d} defaultOpen={i === 0} />
      ))}
    </div>
  );
}

function DayGroup({ day, defaultOpen }: { day: { date: string; count: number; scored: number }; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const entries = useJournalDay(open ? day.date : null);
  const outlook = useMarketViewDay(open ? day.date : null);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-surface-2/40"
      >
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
        <span className="font-medium text-text">{dayLabel(day.date)}</span>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="neutral">{day.count} {day.count === 1 ? "call" : "calls"}</Badge>
          {day.scored > 0 && <Badge tone="accent" dot>{day.scored} scored</Badge>}
        </span>
      </button>
      {open && (
        <div className="border-l border-hairline pl-3 pb-2">
          <DayOutlookBanner theses={outlook.data?.theses ?? []} />
          {entries.isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : (
            <div className="divide-y divide-hairline">
              {(entries.data?.entries ?? []).map((e) => (
                <JournalRow key={e.id} entry={e} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The AI's overall market outlook recorded that day — regime + sector leans + named themes — shown
 * above the day's per-stock calls so each day reads as a complete record (the cross-cutting thesis that
 * framed those calls). Sourced from `ai_theses` via /market-view/day; renders nothing on days with no
 * outlook (e.g. calls recorded before the outlook feature shipped).
 */
function DayOutlookBanner({ theses }: { theses: AiInsight[] }) {
  if (theses.length === 0) return null;
  const regime = theses.find((t) => t.level === "regime") ?? null;
  const sectors = theses.filter((t) => t.level === "sector");
  const themes = theses.filter((t) => t.level === "theme");
  return (
    <div className="glass mb-3 mt-3 space-y-2 p-3">
      <p className="eyebrow">Market outlook</p>
      {regime && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-medium text-text-secondary">Regime</span>
          <Badge tone={stanceTone(regime.stance)} dot>{regime.stance}</Badge>
          {regime.conviction != null && (
            <span className="text-text-muted">{regime.conviction.toFixed(2)} · {regime.horizon}</span>
          )}
          {(regime.headline || regime.body) && (
            <span className="text-text-muted">— {regime.headline || regime.body}</span>
          )}
        </div>
      )}
      {sectors.length > 0 && <OutlookLeanRow label="Sectors" items={sectors} />}
      {themes.length > 0 && <OutlookLeanRow label="Themes" items={themes} />}
    </div>
  );
}

function OutlookLeanRow({ label, items }: { label: string; items: AiInsight[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
      <span className="font-medium text-text-secondary">{label}</span>
      {items.map((i) => (
        <span key={i.id} className="flex items-center gap-1">
          <span className="text-text-secondary">{i.subject}</span>
          <Badge tone={stanceTone(i.stance)}>{i.stance}</Badge>
        </span>
      ))}
    </div>
  );
}

/** Filtered view (from a recommendation card's "View in journal"): all calls for one ticker, flat. */
function TickerJournal({ ticker }: { ticker: string }) {
  const journal = useJournal(ticker);
  const entries = journal.data?.entries ?? [];
  if (journal.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-hairline p-8 text-center text-[12px] text-text-muted">
        No journal entries for {ticker} yet.
      </div>
    );
  }
  return (
    <div className="divide-y divide-hairline">
      {entries.map((e) => (
        <JournalRow key={e.id} entry={e} />
      ))}
    </div>
  );
}

function JournalRow({ entry }: { entry: JournalEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-surface-2/40"
      >
        <span className="w-14 font-semibold tracking-tight text-text">{entry.ticker}</span>
        <Badge tone={ACTION_TONE[entry.action]}>{entry.action}</Badge>
        {entry.scored ? (
          <Badge tone="accent" dot>
            scored
          </Badge>
        ) : (
          <span className="text-[10px] text-text-muted">unscored</span>
        )}
        <span className="tnum ml-auto text-xs text-text-secondary">{(entry.conviction * 100).toFixed(0)}%</span>
        <span className="tnum w-24 text-right text-[11px] text-text-muted">{entry.date}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <JournalDetail entry={entry} />}
    </div>
  );
}

function JournalDetail({ entry }: { entry: JournalEntry }) {
  const detail = useJournalEntry(entry.id);
  const rec = entry.recommendation;
  const pred = rec.prediction;
  const forecast = detail.data?.forecast ?? null;
  const outcome = detail.data?.outcome ?? null;

  return (
    <div className="space-y-3 pb-4 pl-1 pr-1 text-[12px]">
      <p className="leading-relaxed text-text-secondary">{rec.thesis}</p>

      {/* Decision Engine v2 — the reasoning chain behind this call */}
      {rec.calibration && <CalibrationChain stated={rec.conviction} calibration={rec.calibration} />}
      {rec.deliberation && <DeliberationPanel deliberation={rec.deliberation} />}

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="capitalize font-medium text-text-secondary">{pred.direction}</span>
        <span className="text-text-muted">·</span>
        <span className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
          {pred.horizon}
        </span>
        {pred.entry != null && <Field label="Entry" value={usd(pred.entry)} />}
        {pred.stop != null && <Field label="Stop" value={usd(pred.stop)} tone="text-neg" />}
        {pred.target != null && <Field label="Target" value={usd(pred.target)} tone="text-pos" />}
      </div>

      {pred.invalidation && (
        <p className="text-[11px] text-text-muted">
          <span className="font-medium">Invalid:</span> {pred.invalidation}
        </p>
      )}

      {rec.signals.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rec.signals.map((s) => (
            <span
              key={s}
              className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {detail.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : forecast ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-hairline bg-surface-2/50 p-2.5 text-[11px] sm:grid-cols-3">
          <Field label="Side" value={forecast.side} />
          <Field label="Strategy" value={forecast.strategyFamily} />
          <Field label="Ref price" value={usd(forecast.referencePrice)} />
          <Field label="Horizon" value={`${forecast.horizonTradingSessions} sessions`} />
          <Field label="Resolve by" value={forecast.resolveAt} />
          <Field label="Feed" value={forecast.priceFeed} />
        </div>
      ) : null}

      {outcome && <Outcome outcome={outcome} />}

      {rec.sources.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-hairline pt-2">
          {rec.sources.slice(0, 4).map((s) => {
            let label = s.title;
            if (!label) {
              try {
                label = new URL(s.url).hostname;
              } catch {
                label = s.url;
              }
            }
            return (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-accent hover:underline"
              >
                {label}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Outcome({ outcome }: { outcome: ForecastOutcome }) {
  const meta = OUTCOME_META[outcome.outcome];
  return (
    <div className="rounded-lg border border-hairline bg-surface-2/50 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={meta.tone} dot>
          {meta.label}
        </Badge>
        <span className="text-[10px] text-text-muted">resolved {outcome.resolutionDate}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
        <Field label="Return" value={pct(outcome.terminalReturn)} tone={outcome.terminalReturn >= 0 ? "text-pos" : "text-neg"} />
        {outcome.spyExcessReturn != null && (
          <Field
            label={<Term k="vsSpy">vs SPY</Term>}
            value={pct(outcome.spyExcessReturn)}
            tone={outcome.spyExcessReturn >= 0 ? "text-pos" : "text-neg"}
          />
        )}
        {outcome.forecastR != null && <Field label={<Term k="R">R</Term>} value={`${outcome.forecastR.toFixed(2)}×`} />}
        <Field label={<Term k="mfe">MFE</Term>} value={pct(outcome.maxFavorableExcursion)} tone="text-pos" />
        <Field label={<Term k="mae">MAE</Term>} value={pct(outcome.maxAdverseExcursion)} tone="text-neg" />
      </div>
      {outcome.warnings.length > 0 && (
        <p className="mt-1.5 text-[10px] leading-snug text-text-muted">{outcome.warnings.join("; ")}</p>
      )}
    </div>
  );
}

function Field({ label, value, tone }: { label: ReactNode; value: string; tone?: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-[9px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className={cn("tnum font-mono", tone ?? "text-text-secondary")}>{value}</span>
    </span>
  );
}
