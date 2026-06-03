import { useState } from "react";
import { BookMarked, TrendingUp } from "lucide-react";
import type { LessonState, WikiLesson, WikiMetric } from "../api/types.ts";
import { useForecastMarks, useWikiBriefing, useWikiInFlight, useWikiLessons, useWikiMetrics } from "../api/hooks.ts";
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

function InFlightPanel({ data }: { data: { assessment: import("../api/client.ts").InFlightAssessment; calls: import("../api/client.ts").InFlightCall[] } }) {
  const a = data.assessment;
  const r = (x: number | null) => (x == null ? "—" : `${x.toFixed(2)}R`);
  return (
    <div className="mt-5">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-text-muted">
        In-flight book{a.date ? ` · marked ${a.date}` : ""} · {a.total} open
      </p>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-muted">
        <span className="text-pos">{a.onTrack} on track</span>
        <span>{a.atRisk} at risk</span>
        <span className="text-neg">{a.nearStop} near stop</span>
        <span>{a.nearTarget} near target</span>
        <span>avg {r(a.avgUnrealizedR)}</span>
        <span>MFE {r(a.avgMfe)}</span>
        <span>MAE {r(a.avgMae)}</span>
      </div>
      <div className="divide-y divide-hairline">
        {data.calls.map((c) => (
          <InFlightRow key={c.forecastId} call={c} />
        ))}
      </div>
    </div>
  );
}

function InFlightRow({ call }: { call: import("../api/client.ts").InFlightCall }) {
  const [open, setOpen] = useState(false);
  const marks = useForecastMarks(open ? call.forecastId : null);
  const bad = call.status === "near_stop" || call.status === "at_risk";
  return (
    <div className="py-2">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left text-[12px]">
        <span className="font-medium text-text">{call.ticker}</span>
        <span className="text-text-muted">{call.side}</span>
        <span className={bad ? "text-neg" : "text-pos"}>{pct(call.movePct)}</span>
        <span className="text-text-muted">{call.unrealizedR == null ? "—" : `${call.unrealizedR.toFixed(2)}R`}</span>
        <span className="ml-auto text-[10px] text-text-muted">{call.status}{call.resolveBy ? ` · by ${call.resolveBy}` : ""}</span>
      </button>
      {open && (
        <div className="mt-2 flex items-end gap-0.5">
          {(marks.data?.marks ?? []).map((m) => {
            const h = Math.min(24, Math.max(2, Math.round(Math.abs(m.moveFromEntry) * 120)));
            return (
              <span
                key={m.date}
                title={`${m.date}: ${pct(m.moveFromEntry)} · ${m.unrealizedR == null ? "—" : m.unrealizedR.toFixed(2)}R · ${m.status}`}
                className={`w-1.5 rounded-sm ${m.moveFromEntry >= 0 ? "bg-pos/60" : "bg-neg/60"}`}
                style={{ height: `${h}px` }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
