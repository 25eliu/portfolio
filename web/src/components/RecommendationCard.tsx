import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { Action, Recommendation } from "../api/types.ts";
import { cn } from "../lib/cn.ts";
import { usd } from "../lib/format.ts";
import { Badge } from "./ui/Badge.tsx";
import { Term } from "./ui/Term.tsx";
import { DeliberationPanel, CalibrationChain } from "./Reasoning.tsx";
import { nodeId } from "./graph/nodeStyle.ts";
import { useViewInGraph } from "../lib/graphFocus.tsx";

/** Screen types from the discovery layer get a visually distinct (accent) tone. */
const DISCOVERY_SCREENS = new Set(["sentiment", "thematic"]);

function screenTone(screen: string): "accent" | "neutral" {
  return DISCOVERY_SCREENS.has(screen) ? "accent" : "neutral";
}

function screenLabel(screen: string): string {
  return screen.replace(/_/g, " ");
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

const CONVICTION_COLOR: Record<Action, string> = {
  ADD: "bg-pos",
  BUY: "bg-pos",
  TRIM: "bg-neg",
  SELL: "bg-neg",
  HOLD: "bg-text-muted",
  WATCH: "bg-accent",
  PASS: "bg-text-muted",
};

/** Map catalyst sentiment (-1..1) to a tone + label. */
function sentimentTone(s: number): { tone: "pos" | "neg" | "warn"; label: string } {
  if (s > 0.15) return { tone: "pos", label: "bullish" };
  if (s < -0.15) return { tone: "neg", label: "bearish" };
  return { tone: "warn", label: "neutral" };
}

export function RecommendationCard({
  r,
  onViewJournal,
}: {
  r: Recommendation;
  onViewJournal?: (ticker: string) => void;
}) {
  const onViewInGraph = useViewInGraph();
  const [open, setOpen] = useState(false);
  const hasDetail =
    r.technicals.rsi14 != null ||
    r.technicals.macd != null ||
    r.technicals.support != null ||
    r.technicals.resistance != null ||
    r.briefingNote != null;

  const pred = r.prediction;

  return (
    <article className="card p-4 transition-colors hover:border-hairline-strong">
      <header className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold tracking-tight text-text">{r.ticker}</span>
          <Badge tone={ACTION_TONE[r.action]}><Term k={r.action}>{r.action}</Term></Badge>
          {r.screen && (
            <Badge tone={screenTone(r.screen)}>{screenLabel(r.screen)}</Badge>
          )}
        </div>
        <div className="text-right">
          <div className="eyebrow"><Term k="conviction">Conviction</Term></div>
          <div className="tnum text-sm font-semibold text-text">
            {(r.conviction * 100).toFixed(0)}%
          </div>
        </div>
      </header>

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full transition-all", CONVICTION_COLOR[r.action])}
          style={{ width: `${r.conviction * 100}%` }}
        />
      </div>

      {/* Decision Engine v2 — how the track record dampened conviction (graph-propagated calibration) */}
      {r.calibration && (
        <div className="mb-3">
          <CalibrationChain stated={r.conviction} calibration={r.calibration} />
        </div>
      )}

      {/* prediction — direction + horizon + expected return */}
      <div className="mb-3 border-b border-hairline pb-3">
        <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span className="capitalize font-medium text-text-secondary">
            {pred.direction}
          </span>
          <span className="text-text-muted">·</span>
          <span className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
            {pred.horizon}
          </span>
          {pred.expectedReturnPct != null && (
            <span className="flex items-center gap-1">
              <Term k="expectedReturnPct">
                <span className="text-text-muted">exp. return</span>
              </Term>
              <span
                className={cn(
                  "tnum font-mono font-semibold",
                  pred.expectedReturnPct >= 0 ? "text-pos" : "text-neg",
                )}
              >
                {pred.expectedReturnPct >= 0 ? "+" : ""}
                {pred.expectedReturnPct.toFixed(1)}%
              </span>
            </span>
          )}
        </div>

        {/* WATCH: trigger → action line */}
        {r.action === "WATCH" && pred.trigger && (
          <p className="text-[12px] leading-snug text-text-secondary">
            <span className="font-medium text-accent">
              {pred.actionIfTriggered ?? "Act"} <Term k="trigger">if</Term>
            </span>{" "}
            {pred.trigger}
            {pred.target != null && (
              <> → target <span className="tnum font-mono">{usd(pred.target)}</span></>
            )}
          </p>
        )}

        {/* Held/Buy positions: entry / target / stop row */}
        {r.action !== "WATCH" && (pred.entry != null || pred.target != null || pred.stop != null) && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(4rem,1fr))] gap-2 rounded-lg border border-hairline bg-surface-2/50 p-2.5">
            {pred.entry != null && (
              <Plan label="Entry" value={usd(pred.entry)} />
            )}
            {pred.stop != null && (
              <Plan label="Stop" value={usd(pred.stop)} tone="text-neg" />
            )}
            {pred.target != null && (
              <Plan label="Target" value={usd(pred.target)} tone="text-pos" />
            )}
            {pred.rMultiple != null && (
              <Plan label={<Term k="rMultiple">R</Term>} value={`${pred.rMultiple.toFixed(1)}×`} />
            )}
          </div>
        )}

        {/* Invalidation */}
        {pred.invalidation && (
          <p className="mt-1.5 text-[11px] text-text-muted">
            <span className="font-medium"><Term k="invalidation">Invalid</Term>:</span> {pred.invalidation}
          </p>
        )}
      </div>

      <p className="mb-3 text-[13px] leading-relaxed text-text-secondary">{r.thesis}</p>

      {/* Decision Engine v2 — the bull/bear deliberation that preceded the verdict */}
      {r.deliberation && (
        <div className="mb-3">
          <DeliberationPanel deliberation={r.deliberation} />
        </div>
      )}

      {r.signals.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {r.signals.map((s) => (
            <span
              key={s}
              className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {r.catalyst && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-hairline bg-surface-2 px-2.5 py-2">
          <Badge tone={sentimentTone(r.catalyst.sentiment).tone} dot>
            {sentimentTone(r.catalyst.sentiment).label}
          </Badge>
          <p className="flex-1 text-[11px] leading-snug text-text-secondary">
            {r.catalyst.summary}
          </p>
        </div>
      )}

      {r.fundamentals && (
        <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg border border-hairline bg-surface-2/50 p-2.5 text-[11px]">
          <FundStat
            label={<Term k="peTrailing">P/E</Term>}
            value={r.fundamentals.peTrailing != null ? r.fundamentals.peTrailing.toFixed(1) : "—"}
          />
          <FundStat
            label="Rev YoY"
            value={r.fundamentals.revenueGrowthYoY != null ? `${r.fundamentals.revenueGrowthYoY.toFixed(0)}%` : "—"}
          />
          <FundStat
            label="Net mgn"
            value={r.fundamentals.netMargin != null ? `${r.fundamentals.netMargin.toFixed(0)}%` : "—"}
          />
          <FundStat
            label="Tgt up"
            value={r.priceTargetUpside != null ? `${r.priceTargetUpside.toFixed(0)}%` : "—"}
          />
        </div>
      )}

      {r.sources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-hairline pt-2">
          {r.sources.slice(0, 3).map((s) => {
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

      {hasDetail && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-3 flex w-full items-center justify-center gap-1 border-t border-hairline pt-2.5 text-[11px] text-text-muted transition-colors hover:text-text-secondary"
          >
            {open ? "Hide" : "Details"}
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            />
          </button>
          {open && (
            <div className="mt-2.5 space-y-2 text-[11px]">
              <div className="grid grid-cols-2 gap-2">
                {r.technicals.rsi14 != null && (
                  <Detail label={<Term k="rsi14">RSI</Term>} value={r.technicals.rsi14.toFixed(0)} />
                )}
                {r.technicals.macd != null && (
                  <Detail label={<Term k="macd">MACD</Term>} value={r.technicals.macd.toFixed(2)} />
                )}
                {r.technicals.support != null && (
                  <Detail label="Support" value={usd(r.technicals.support)} />
                )}
                {r.technicals.resistance != null && (
                  <Detail label="Resistance" value={usd(r.technicals.resistance)} />
                )}
              </div>
              {r.briefingNote && (
                <p className="leading-snug text-text-muted">{r.briefingNote}</p>
              )}
            </div>
          )}
        </>
      )}

      {(onViewJournal || onViewInGraph) && (
        <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-2.5 text-[11px]">
          {onViewJournal && (
            <button onClick={() => onViewJournal(r.ticker)} className="flex-1 text-text-muted transition-colors hover:text-accent">
              View in journal →
            </button>
          )}
          {onViewInGraph && (
            <button onClick={() => onViewInGraph(nodeId("ticker", r.ticker))} className="flex-1 text-text-muted transition-colors hover:text-accent">
              View in graph →
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function Plan({ label, value, tone }: { label: ReactNode; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={cn("tnum font-mono text-xs", tone ?? "text-text")}>{value}</div>
    </div>
  );
}

function Detail({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-surface-2 px-2 py-1">
      <span className="text-text-muted">{label}</span>
      <span className="tnum font-mono text-text-secondary">{value}</span>
    </div>
  );
}

function FundStat({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="tnum font-mono text-[11px] text-text-secondary">{value}</div>
    </div>
  );
}
