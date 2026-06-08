import { useState } from "react";
import { BookMarked, ChevronDown, TrendingUp } from "lucide-react";
import type { ForecastDailyMark, InFlightAssessment, InFlightCall } from "../api/client.ts";
import type { LessonState, WikiLesson, WikiMetric } from "../api/types.ts";
import { useForecastMarks, useWikiBriefing, useWikiInFlight, useWikiLessons, useWikiMetrics, useWikiTickers } from "../api/hooks.ts";
import { cn } from "../lib/cn.ts";
import type { ReactNode } from "react";
import { Badge } from "./ui/Badge.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";
import { Sparkline } from "./ui/Sparkline.tsx";
import { Term } from "./ui/Term.tsx";
import { chart } from "../lib/chartTheme.ts";
import { nodeId } from "./graph/nodeStyle.ts";
import { useViewInGraph } from "../lib/graphFocus.tsx";
import { useViewInJournal } from "../lib/journalFocus.tsx";
import { CALL_TONE, STATUS_LABEL, groupCalls, type InFlightGroup, type StatusCount } from "./wiki/inFlight.ts";
import { TickerHistoryPanel } from "./wiki/TickerHistory.tsx";

const STATE_TONE: Record<LessonState, "pos" | "accent" | "neutral" | "warn"> = {
  active: "pos",
  provisional: "accent",
  draft: "neutral",
  superseded: "neutral",
  expired: "warn",
  rejected: "warn",
};

const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);

/** Region 6 — the performance wiki: compiled briefing, evidence-gated lessons, calibration metrics. */
export function Wiki() {
  const briefing = useWikiBriefing();
  const lessons = useWikiLessons();
  const metrics = useWikiMetrics("all_time");
  const inFlight = useWikiInFlight();
  const tickers = useWikiTickers();

  const overall = metrics.data?.metrics.find((m) => m.cohortKey === "overall");
  const loading = briefing.isLoading || lessons.isLoading;
  // Show the rich panels (live book, per-ticker record) as soon as any forecasts exist — not only once
  // cohort lessons compile (which needs ≥5 resolved calls). Empty-only state still shows the hint below.
  const hasContent =
    (lessons.data?.lessons.length ?? 0) > 0 ||
    !!briefing.data?.briefing ||
    (inFlight.data?.calls.length ?? 0) > 0 ||
    (tickers.data?.tickers.length ?? 0) > 0;

  return (
    <div className="card p-6">
      <div className="mb-5 flex items-center gap-2">
        <BookMarked className="h-4 w-4 text-text-muted" />
        <p className="text-sm font-medium text-text-secondary">Performance wiki</p>
        <span className="ml-auto text-[11px] text-text-muted">compiled from resolved forecast outcomes</span>
      </div>

      {loading ? (
        <Skeleton className="h-28 w-full" />
      ) : !hasContent ? (
        <p className="rounded-xl border border-dashed border-hairline p-6 text-center text-[12px] text-text-muted">
          No lessons yet — the wiki compiles once forecasts resolve (needs ≥5 resolved calls in a cohort).
          Until then, analysis runs without a track-record briefing.
        </p>
      ) : (
        <div className="space-y-5">
          {overall && <CalibrationStrip m={overall} />}

          {/* The live, clickable book sits first — it's the interactive view. The briefing below is the
              static text snapshot injected into analysis, collapsed so it doesn't bury the UI. */}
          {(inFlight.data?.calls.length ?? 0) > 0 && <InFlightPanel data={inFlight.data!} />}

          {(tickers.data?.tickers.length ?? 0) > 0 && <TickerHistoryPanel tickers={tickers.data!.tickers} />}

          {briefing.data?.briefing && <BriefingBlock body={briefing.data.briefing.body} />}

          <div className="space-y-2">
            {(lessons.data?.lessons ?? []).map((l) => (
              <LessonRow key={l.id} lesson={l} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CalibrationStrip({ m }: { m: WikiMetric }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      <Stat label="Resolved" value={String(m.n)} />
      <Stat label={<Term k="hitRate">Hit rate</Term>} value={pct(m.hitRate)} icon />
      <Stat label={<Term k="statedConviction">Stated conv</Term>} value={pct(m.avgConviction)} />
      <Stat label={<Term k="expectancy">Expectancy</Term>} value={m.expectancyR != null ? `${m.expectancyR.toFixed(2)}R` : "—"} />
      <Stat label={<Term k="vsSpy">vs SPY</Term>} value={pct(m.avgSpyExcess)} />
      <Stat label={<Term k="brier">Brier</Term>} value={m.brier != null ? m.brier.toFixed(3) : "—"} />
    </div>
  );
}

function Stat({ label, value, icon }: { label: ReactNode; value: string; icon?: boolean }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-2/50 p-2.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-text-muted">
        {icon && <TrendingUp className="h-3 w-3" />} {label}
      </div>
      <div className="tnum mt-0.5 text-sm font-semibold text-text">{value}</div>
    </div>
  );
}

function LessonRow({ lesson }: { lesson: WikiLesson }) {
  const onViewInGraph = useViewInGraph();
  return (
    <div className="rounded-lg border border-hairline bg-surface-2/30 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[12px] font-medium text-text">{lesson.title}</span>
        <Badge tone={STATE_TONE[lesson.state]} dot>
          {lesson.state}
        </Badge>
        <span className="tnum ml-auto text-[10px] text-text-muted">n={lesson.n}</span>
        {onViewInGraph && (
          <button
            onClick={() => onViewInGraph(nodeId("lesson", lesson.id))}
            className="text-[10px] text-text-muted transition-colors hover:text-accent"
          >
            graph ↗
          </button>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-text-muted">{lesson.body}</p>
    </div>
  );
}

// Status tone → text color, for coloring the composite status spread on a group header.
const TONE_TEXT: Record<string, string> = {
  neg: "text-neg", warn: "text-warn", accent: "text-accent", pos: "text-pos", neutral: "text-text-muted",
};
const SEGMENTS = [
  { key: "nearStop", label: "near stop", cls: "bg-neg" },
  { key: "atRisk", label: "at risk", cls: "bg-warn" },
  { key: "nearTarget", label: "near target", cls: "bg-accent" },
  { key: "onTrack", label: "on track", cls: "bg-pos" },
] as const;

const fmtR = (x: number | null) => (x == null ? "—" : `${x.toFixed(2)}R`);
const fmtPrice = (x: number | null) => (x == null ? "—" : x.toFixed(2));
// Color an R figure by sign so a winning bet reads green and a losing one red (no more lone-red headline).
const rTone = (x: number | null) => (x == null ? "text-text-muted" : x >= 0 ? "text-pos" : "text-neg");

/** The active briefing text injected into analysis — collapsed by default so it doesn't bury the live
 *  book above it. It's a static snapshot; the interactive panel is the thing you click into. */
function BriefingBlock({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-hairline bg-surface-2/40">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-3 text-left transition-colors hover:bg-surface-2/50"
      >
        <span className="text-[11px] font-medium text-text-secondary">Active briefing · injected into analysis</span>
        <span className="ml-auto text-[10px] text-text-muted">{open ? "hide" : "show text"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <pre className="whitespace-pre-wrap border-t border-hairline px-3.5 py-3 font-sans text-[11px] leading-relaxed text-text-muted">
          {body}
        </pre>
      )}
    </div>
  );
}

function InFlightPanel({ data }: { data: { assessment: InFlightAssessment; calls: InFlightCall[] } }) {
  const [open, setOpen] = useState(true);
  const a = data.assessment;
  const groups = groupCalls(data.calls);
  return (
    <div className="rounded-xl border border-hairline bg-surface-2/30">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2/40"
      >
        <span className="text-[11px] uppercase tracking-wide text-text-muted shrink-0">
          Live calls · {a.total} open
        </span>
        <StatusBar a={a} />
        <span className="tnum ml-auto shrink-0 text-[11px] text-text-muted">avg {fmtR(a.avgUnrealizedR)}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-hairline px-1.5">
          <div className="mb-1 flex flex-wrap gap-x-4 gap-y-0.5 px-2 pt-2 text-[10px] text-text-muted">
            <span>marked {a.date ?? "—"}</span>
            <span>avg MFE {fmtR(a.avgMfe)}</span>
            <span>avg MAE {fmtR(a.avgMae)}</span>
            <span>{groups.length} tickers · best avg R first</span>
            <span className="text-text-muted/70">click a ticker to expand</span>
          </div>
          <div className="divide-y divide-hairline">
            {groups.map((g) => (
              <GroupRow key={g.key} group={g} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Segmented distribution bar — proportional widths per status, attention colors first. */
function StatusBar({ a }: { a: InFlightAssessment }) {
  const total = a.total || 1;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="flex h-1.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-surface-3">
        {SEGMENTS.map((s) => {
          const n = a[s.key];
          return n > 0 ? <span key={s.key} className={s.cls} style={{ width: `${(n / total) * 100}%` }} /> : null;
        })}
      </span>
      <span className="hidden shrink-0 text-[10px] text-text-muted sm:inline">
        {a.nearStop > 0 && <span className="text-neg">{a.nearStop} near stop</span>}
        {a.nearStop > 0 && a.atRisk > 0 && " · "}
        {a.atRisk > 0 && <span className="text-warn">{a.atRisk} at risk</span>}
      </span>
    </span>
  );
}

/** Compact, attention-first status spread for a multi-bet group, e.g. "1 near stop · 8 on track". */
function StatusSpread({ counts }: { counts: StatusCount[] }) {
  return (
    <span className="flex items-center gap-1.5 text-[10px]">
      {counts.map((c, i) => (
        <span key={c.status} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-text-muted/50">·</span>}
          <span className={TONE_TEXT[CALL_TONE[c.status] ?? "neutral"]}>
            {c.n} {STATUS_LABEL[c.status]}
          </span>
        </span>
      ))}
    </span>
  );
}

function GroupRow({ group }: { group: InFlightGroup }) {
  const [open, setOpen] = useState(false);
  const single = group.count === 1;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-2 py-2 text-left text-[12px] transition-colors hover:bg-surface-2/40"
      >
        <span className="font-medium text-text">{group.ticker}</span>
        <span className="text-text-muted">{group.side}</span>
        {!single && <Badge tone="neutral">×{group.count}</Badge>}
        {/* Headline = net (avg) current R — the book's real standing — colored by sign. */}
        <span className={cn("tnum font-medium", rTone(group.netR))}>{fmtR(group.netR)}</span>
        {/* Worst bet as a muted risk chip, so it informs without painting the whole row red. */}
        {!single && group.worstR != null && (
          <span className="tnum text-[11px] text-text-muted">worst {fmtR(group.worstR)}</span>
        )}
        <span className="ml-auto flex items-center">
          {single ? (
            <Badge tone={CALL_TONE[group.worstStatus] ?? "neutral"}>{group.worstStatus}</Badge>
          ) : (
            <StatusSpread counts={group.statusCounts} />
          )}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-2 pb-2">
          {single ? (
            <CallDetail call={group.calls[0]!} />
          ) : (
            <div className="rounded-lg border border-hairline bg-surface/40">
              {/* Column key — "R now" is the live signal; "move" is the underlying's move (a short's +move is a loss). */}
              <div className="flex items-center gap-3 px-2.5 pt-1.5 pb-1 text-[9px] uppercase tracking-wide text-text-muted">
                <span className="w-12">move</span>
                <span className="w-14">R now</span>
                <span className="ml-auto">status · resolves</span>
              </div>
              <div className="divide-y divide-hairline border-t border-hairline">
                {group.calls.map((c) => (
                  <CallRow key={c.forecastId} call={c} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CallRow({ call }: { call: InFlightCall }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-2.5 py-1.5 text-left text-[11px]"
      >
        {/* Underlying move, muted — a short's positive move is a loss, so don't color it like a gain. */}
        <span className="tnum w-12 text-text-muted">{pct(call.movePct)}</span>
        {/* Live R is the real signal, colored by sign. */}
        <span className={cn("tnum w-14", rTone(call.unrealizedR))}>{fmtR(call.unrealizedR)}</span>
        <span className="ml-auto text-[10px] text-text-muted">
          {call.status}{call.resolveBy ? ` · by ${call.resolveBy}` : ""}
        </span>
        <ChevronDown className={cn("h-3 w-3 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <CallDetail call={call} />}
    </div>
  );
}

/** Per-prediction daily trajectory: how this one call's unrealized R has tracked day by day since entry. */
function ForecastTrajectory({ forecastId }: { forecastId: string }) {
  const marks = useForecastMarks(forecastId);
  if (marks.isLoading) return <Skeleton className="h-16 w-full" />;
  const rows: ForecastDailyMark[] = marks.data?.marks ?? [];
  if (rows.length === 0) return null;
  const series = rows.map((m) => m.unrealizedR ?? 0);
  const lastR = rows[rows.length - 1]!.unrealizedR ?? 0;
  return (
    <div className="rounded-lg border border-hairline bg-surface/40 p-2">
      <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wide text-text-muted">
        <span>daily track · R since entry</span>
        <span>{rows.length} {rows.length === 1 ? "day" : "days"}</span>
      </div>
      <Sparkline data={series} color={lastR >= 0 ? chart.pos : chart.neg} height={32} />
      <div className="mt-1 divide-y divide-hairline">
        {rows.map((m) => (
          <div key={m.id} className="flex items-center gap-3 py-0.5 text-[10px]">
            <span className="tnum w-20 text-text-muted">{m.date}</span>
            <span className={cn("tnum w-12", rTone(m.unrealizedR))}>{fmtR(m.unrealizedR)}</span>
            <span className="ml-auto text-text-muted">{m.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The feedback view for one call: why the AI made it, where price sits in its risk frame, its day-by-day
 *  track, and a link back to the originating journal entry. */
function CallDetail({ call }: { call: InFlightCall }) {
  const viewInJournal = useViewInJournal();
  return (
    <div className="space-y-2 px-2 pb-1 pt-1.5 text-[11px]">
      {call.thesis && <p className="leading-relaxed text-text-secondary">{call.thesis}</p>}
      {call.rationale && <p className="leading-relaxed text-text-muted">{call.rationale}</p>}
      <div className="tnum flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
        <span>
          entry {fmtPrice(call.entry)} <span className="text-text-muted/60">→</span>{" "}
          <span className="text-text">now {fmtPrice(call.markPrice)}</span>
        </span>
        <span className="text-neg">stop {fmtPrice(call.stop)}</span>
        <span className="text-accent">target {fmtPrice(call.target)}</span>
      </div>

      <ForecastTrajectory forecastId={call.forecastId} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-text-muted">
        <span>MFE {fmtR(call.mfe)}</span>
        <span>MAE {fmtR(call.mae)}</span>
        {call.conviction != null && <span>conviction {pct(call.conviction)}</span>}
        {call.resolveBy && <span>resolves {call.resolveBy}</span>}
        {viewInJournal && call.journalEntryId && (
          <button
            onClick={() => viewInJournal(call.journalEntryId!, call.ticker)}
            className="ml-auto text-text-muted transition-colors hover:text-accent"
          >
            View in journal →
          </button>
        )}
      </div>
    </div>
  );
}
