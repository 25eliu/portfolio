import { useState } from "react";
import { ChevronDown, Scale, SlidersHorizontal } from "lucide-react";
import type { Calibration, Deliberation } from "../api/types.ts";
import { cn } from "../lib/cn.ts";
import { Term } from "./ui/Term.tsx";

/** "sector:Information Technology" → "Information Technology"; "overall" → "overall". */
function cohortLabel(key: string): string {
  const i = key.indexOf(":");
  return i === -1 ? key : key.slice(i + 1);
}

const COHORT_KIND_LABEL: Record<string, string> = {
  sector: "sector",
  strategy_family: "strategy",
  overall: "overall",
  side: "side",
};

/**
 * The graph-propagated calibration chain (Decision Engine v2): how the AI dampened the model's stated
 * conviction toward what this kind of call has actually achieved. Renders a compact headline always (when
 * calibration ran) and expands to the per-cohort contributions — the same shrinkage blend over the
 * ticker's sector / strategy / overall graph cohorts, made legible. Renders nothing for legacy rows.
 */
export function CalibrationChain({
  stated,
  calibration,
}: {
  stated: number;
  calibration: Calibration | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!calibration) return null;
  const calibrated = stated * calibration.factor;
  const damped = calibration.factor < 0.995;
  const cohorts = calibration.adjustments.filter((a) => a.overconfidence > 0.005);

  return (
    <div className="rounded-lg border border-hairline bg-surface-2/40 p-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-[11px]"
        disabled={!damped && cohorts.length === 0}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span className="font-medium text-text-secondary">
          <Term k="calibration">Calibrated conviction</Term>
        </span>
        {damped ? (
          <span className="tnum ml-auto flex items-center gap-1.5 font-mono">
            <span className="text-text-muted line-through">{(stated * 100).toFixed(0)}%</span>
            <span className="text-text-muted">→</span>
            <span className="font-semibold text-text">{(calibrated * 100).toFixed(0)}%</span>
          </span>
        ) : (
          <span className="tnum ml-auto font-mono text-text-muted">no adjustment ({(stated * 100).toFixed(0)}%)</span>
        )}
        {(damped || cohorts.length > 0) && (
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
        )}
      </button>

      {damped && !open && calibration.reason && (
        <p className="mt-1 pl-5 text-[10px] leading-snug text-text-muted">{calibration.reason}</p>
      )}

      {open && (
        <div className="mt-2 space-y-1.5 pl-5">
          {cohorts.length > 0 ? (
            cohorts.map((a) => (
              <div key={`${a.cohortKind}:${a.cohortKey}`} className="flex items-center gap-2 text-[10px]">
                <span className="rounded border border-hairline bg-surface px-1.5 py-0.5 text-text-muted">
                  {COHORT_KIND_LABEL[a.cohortKind] ?? a.cohortKind}
                </span>
                <span className="text-text-secondary">{cohortLabel(a.cohortKey)}</span>
                <span className="tnum ml-auto flex items-center gap-2 font-mono text-text-muted">
                  <span>n={a.n}</span>
                  <Term k="overconfidence">
                    <span className="text-warn">+{a.overconfidence.toFixed(2)}</span>
                  </Term>
                  <span className="w-10 text-right">{(a.weight * 100).toFixed(0)}% wt</span>
                </span>
              </div>
            ))
          ) : (
            <p className="text-[10px] text-text-muted">No track record yet — conviction passes through unadjusted.</p>
          )}
          {calibration.regimeFactor < 0.995 && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="rounded border border-hairline bg-surface px-1.5 py-0.5 text-text-muted">
                <Term k="regime">regime</Term>
              </span>
              <span className="tnum ml-auto font-mono text-warn">×{calibration.regimeFactor.toFixed(2)} (risk-off)</span>
            </div>
          )}
          <p className="border-t border-hairline pt-1.5 text-[10px] leading-snug text-text-muted">
            Stated conviction is the model's; this dampened value is what the planner sizes on. Calibration only ever lowers it.
          </p>
        </div>
      )}
    </div>
  );
}

const STANCE_TONE: Record<string, string> = {
  bullish: "text-pos",
  bearish: "text-neg",
  neutral: "text-text-muted",
};

/**
 * The bull/bear deliberation the AI ran before committing (Decision Engine v2). Collapsible so it never
 * dominates the card; expanded it shows the steelmanned cases, what would prove the call wrong
 * (disconfirmers), and the provisional read. Renders nothing for legacy rows without a deliberation.
 */
export function DeliberationPanel({ deliberation }: { deliberation: Deliberation | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!deliberation) return null;
  const d = deliberation;

  return (
    <div className="rounded-lg border border-hairline bg-surface-2/40">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[11px]"
      >
        <Scale className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span className="font-medium text-text-secondary">
          <Term k="deliberation">Bull / bear deliberation</Term>
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-text-muted">
          provisional
          <span className={cn("font-medium capitalize", STANCE_TONE[d.provisionalStance])}>{d.provisionalStance}</span>
          <span className="tnum font-mono">{(d.provisionalConviction * 100).toFixed(0)}%</span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-hairline px-2.5 py-2.5 text-[11px] leading-relaxed">
          {d.bullCase && (
            <div>
              <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-pos">Bull case</div>
              <p className="text-text-secondary">{d.bullCase}</p>
            </div>
          )}
          {d.bearCase && (
            <div>
              <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-neg">Bear case</div>
              <p className="text-text-secondary">{d.bearCase}</p>
            </div>
          )}
          {d.disconfirmers.length > 0 && (
            <div>
              <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted">
                <Term k="disconfirmers">Would be wrong if</Term>
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-text-muted">
                {d.disconfirmers.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {d.keyUncertainties.length > 0 && (
            <div>
              <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted">Key uncertainties</div>
              <ul className="list-disc space-y-0.5 pl-4 text-text-muted">
                {d.keyUncertainties.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          {d.baseRateNote && (
            <p className="text-[10px] text-text-muted">
              <span className="font-medium">Base rate:</span> {d.baseRateNote}
            </p>
          )}
          {d.reversalCheck && (
            <p className="rounded border border-hairline bg-surface/50 px-2 py-1 text-[10px] text-text-muted">
              <span className="font-medium text-text-secondary">Reversal:</span> {d.reversalCheck}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
