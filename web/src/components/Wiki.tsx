import { useState } from "react";
import { BookMarked, ChevronDown, TrendingUp } from "lucide-react";
import type { InFlightAssessment, InFlightCall } from "../api/client.ts";
import type { LessonState, WikiLesson, WikiMetric } from "../api/types.ts";
import { useWikiBriefing, useWikiInFlight, useWikiLessons, useWikiMetrics } from "../api/hooks.ts";
import { cn } from "../lib/cn.ts";
import { Badge } from "./ui/Badge.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";

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

  const overall = metrics.data?.metrics.find((m) => m.cohortKey === "overall");
  const loading = briefing.isLoading || lessons.isLoading;
  const hasContent = (lessons.data?.lessons.length ?? 0) > 0 || !!briefing.data?.briefing;

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

          {briefing.data?.briefing && (
            <div className="rounded-xl border border-hairline bg-surface-2/40 p-3.5">
              <div className="mb-1.5 text-[11px] font-medium text-text-secondary">
                Active briefing · injected into analysis
              </div>
              <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-text-muted">
                {briefing.data.briefing.body}
              </pre>
            </div>
          )}

          {(inFlight.data?.calls.length ?? 0) > 0 && <InFlightPanel data={inFlight.data!} />}

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
      <Stat label="Hit rate" value={pct(m.hitRate)} icon />
      <Stat label="Stated conv" value={pct(m.avgConviction)} />
      <Stat label="Expectancy" value={m.expectancyR != null ? `${m.expectancyR.toFixed(2)}R` : "—"} />
      <Stat label="vs SPY" value={pct(m.avgSpyExcess)} />
      <Stat label="Brier" value={m.brier != null ? m.brier.toFixed(3) : "—"} />
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
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
  return (
    <div className="rounded-lg border border-hairline bg-surface-2/30 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[12px] font-medium text-text">{lesson.title}</span>
        <Badge tone={STATE_TONE[lesson.state]} dot>
          {lesson.state}
        </Badge>
        <span className="tnum ml-auto text-[10px] text-text-muted">n={lesson.n}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-text-muted">{lesson.body}</p>
    </div>
  );
}

// In-flight call status → semantic tone + worst-first severity rank (lower = needs attention sooner).
const CALL_TONE: Record<string, "neg" | "warn" | "accent" | "pos" | "neutral"> = {
  near_stop: "neg", at_risk: "warn", near_target: "accent", on_track: "pos",
};
const CALL_SEVERITY: Record<string, number> = { near_stop: 0, at_risk: 1, near_target: 2, on_track: 3 };
const SEGMENTS = [
  { key: "nearStop", label: "near stop", cls: "bg-neg" },
  { key: "atRisk", label: "at risk", cls: "bg-warn" },
  { key: "nearTarget", label: "near target", cls: "bg-accent" },
  { key: "onTrack", label: "on track", cls: "bg-pos" },
] as const;

const fmtR = (x: number | null) => (x == null ? "—" : `${x.toFixed(2)}R`);
const fmtPrice = (x: number | null) => (x == null ? "—" : x.toFixed(2));

type InFlightGroup = {
  key: string; ticker: string; side: string | null;
  count: number; worstR: number | null; avgR: number | null; worstStatus: string; calls: InFlightCall[];
};

/** Collapse calls into ticker+direction groups so repeated bets on one thesis (concentration) surface as one row. */
function groupCalls(calls: InFlightCall[]): InFlightGroup[] {
  const map = new Map<string, InFlightCall[]>();
  for (const c of calls) {
    const key = `${c.ticker}|${c.side ?? ""}`;
    (map.get(key) ?? map.set(key, []).get(key)!).push(c);
  }
  const groups = [...map.entries()].map(([key, members]): InFlightGroup => {
    const sorted = [...members].sort((a, b) => (a.unrealizedR ?? 0) - (b.unrealizedR ?? 0));
    const rs = members.map((m) => m.unrealizedR).filter((r): r is number => r != null);
    const worstStatus = members.reduce(
      (w, m) => ((CALL_SEVERITY[m.status] ?? 9) < (CALL_SEVERITY[w] ?? 9) ? m.status : w),
      members[0]!.status,
    );
    return {
      key, ticker: members[0]!.ticker, side: members[0]!.side, count: members.length,
      worstR: rs.length ? Math.min(...rs) : null,
      avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
      worstStatus, calls: sorted,
    };
  });
  // Most-at-risk groups first: worst status, then deepest-negative worst R.
  return groups.sort(
    (a, b) =>
      (CALL_SEVERITY[a.worstStatus] ?? 9) - (CALL_SEVERITY[b.worstStatus] ?? 9) ||
      (a.worstR ?? 0) - (b.worstR ?? 0),
  );
}

function InFlightPanel({ data }: { data: { assessment: InFlightAssessment; calls: InFlightCall[] } }) {
  const [open, setOpen] = useState(false);
  const a = data.assessment;
  const groups = groupCalls(data.calls);
  return (
    <div className="mt-5 rounded-xl border border-hairline bg-surface-2/30">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-2/40"
      >
        <span className="text-[11px] uppercase tracking-wide text-text-muted shrink-0">
          In-flight · {a.total} open
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
            <span>{groups.length} tickers</span>
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
        <span className="tnum text-neg">{fmtR(group.worstR)}</span>
        {!single && <span className="tnum text-[11px] text-text-muted">avg {fmtR(group.avgR)}</span>}
        <Badge tone={CALL_TONE[group.worstStatus] ?? "neutral"} className="ml-auto">
          {group.worstStatus}
        </Badge>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="px-2 pb-2">
          {single ? (
            <CallDetail call={group.calls[0]!} />
          ) : (
            <div className="divide-y divide-hairline rounded-lg border border-hairline bg-surface/40">
              {group.calls.map((c) => (
                <CallRow key={c.forecastId} call={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CallRow({ call }: { call: InFlightCall }) {
  const [open, setOpen] = useState(false);
  const bad = call.status === "near_stop" || call.status === "at_risk";
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-2.5 py-1.5 text-left text-[11px]"
      >
        <span className={cn("tnum w-12", bad ? "text-neg" : "text-pos")}>{pct(call.movePct)}</span>
        <span className="tnum w-14 text-text-muted">{fmtR(call.unrealizedR)}</span>
        <span className="ml-auto text-[10px] text-text-muted">
          {call.status}{call.resolveBy ? ` · by ${call.resolveBy}` : ""}
        </span>
        <ChevronDown className={cn("h-3 w-3 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <CallDetail call={call} />}
    </div>
  );
}

/** The feedback view for one call: why the AI made it, and where price sits within its risk frame. */
function CallDetail({ call }: { call: InFlightCall }) {
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
        <span>MFE {fmtR(call.mfe)}</span>
        <span>MAE {fmtR(call.mae)}</span>
        {call.conviction != null && <span>conviction {pct(call.conviction)}</span>}
        {call.resolveBy && <span>resolves {call.resolveBy}</span>}
      </div>
    </div>
  );
}
