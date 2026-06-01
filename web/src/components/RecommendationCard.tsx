import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Action, Recommendation } from "../api/types.ts";
import { cn } from "../lib/cn.ts";
import { usd } from "../lib/format.ts";
import { Badge } from "./ui/Badge.tsx";

const ACTION_TONE: Record<Action, "pos" | "neg" | "neutral" | "accent"> = {
  BUY: "pos",
  SELL: "neg",
  HOLD: "neutral",
  WATCH: "accent",
};

const CONVICTION_COLOR: Record<Action, string> = {
  BUY: "bg-pos",
  SELL: "bg-neg",
  HOLD: "bg-text-muted",
  WATCH: "bg-accent",
};

/** Map catalyst sentiment (-1..1) to a tone + label. */
function sentimentTone(s: number): { tone: "pos" | "neg" | "warn"; label: string } {
  if (s > 0.15) return { tone: "pos", label: "bullish" };
  if (s < -0.15) return { tone: "neg", label: "bearish" };
  return { tone: "warn", label: "neutral" };
}

export function RecommendationCard({ r }: { r: Recommendation }) {
  const [open, setOpen] = useState(false);
  const hasDetail =
    r.technicals.rsi14 != null ||
    r.technicals.macd != null ||
    r.technicals.support != null ||
    r.technicals.resistance != null ||
    r.briefingNote != null;

  return (
    <article className="card p-4 transition-colors hover:border-hairline-strong">
      <header className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold tracking-tight text-text">{r.ticker}</span>
          <Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge>
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
            {r.horizon}
          </span>
        </div>
        <div className="text-right">
          <div className="eyebrow">Conviction</div>
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

      <p className="mb-3 text-[13px] leading-relaxed text-text-secondary">{r.thesis}</p>

      {r.signals.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {r.signals.map((s) => (
            <span
              key={s}
              className="rounded-md border border-hairline bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-secondary"
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

      {r.tradePlan && (
        <div className="grid grid-cols-4 gap-2 rounded-lg border border-hairline bg-surface-2/50 p-2.5">
          <Plan label="Entry" value={usd(r.tradePlan.entry)} />
          <Plan label="Stop" value={usd(r.tradePlan.stop)} tone="text-neg" />
          <Plan label="Target" value={usd(r.tradePlan.target)} tone="text-pos" />
          <Plan label="R" value={`${r.tradePlan.rMultiple.toFixed(1)}×`} />
        </div>
      )}

      {r.watchTrigger && (
        <div className="mt-3 rounded-lg border border-accent/20 bg-accent-soft px-2.5 py-2 text-[11px] text-text-secondary">
          <span className="font-medium text-accent">Trigger</span> · {r.watchTrigger}
        </div>
      )}

      {hasDetail && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-3 flex w-full items-center justify-center gap-1 border-t border-hairline pt-2.5 text-[11px] text-text-muted transition-colors hover:text-text-secondary"
          >
            {open ? "Hide" : "Details"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="mt-2.5 space-y-2 text-[11px]">
              <div className="grid grid-cols-2 gap-2">
                {r.technicals.rsi14 != null && <Detail label="RSI" value={r.technicals.rsi14.toFixed(0)} />}
                {r.technicals.macd != null && <Detail label="MACD" value={r.technicals.macd.toFixed(2)} />}
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
    </article>
  );
}

function Plan({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={cn("tnum font-mono text-xs", tone ?? "text-text")}>{value}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-surface-2 px-2 py-1">
      <span className="text-text-muted">{label}</span>
      <span className="tnum font-mono text-text-secondary">{value}</span>
    </div>
  );
}
