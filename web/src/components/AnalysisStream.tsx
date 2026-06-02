import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, Sparkles } from "lucide-react";
import { useRunStream, type Lane, type ToolHit } from "../api/runStream.ts";
import { Badge } from "./ui/Badge.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";
import { cn } from "../lib/cn.ts";

const ACTION_TONE: Record<string, "pos" | "neg" | "neutral" | "accent"> = {
  ADD: "pos", BUY: "pos", TRIM: "neg", SELL: "neg", HOLD: "neutral", WATCH: "accent", PASS: "neutral",
};

const STATUS_RANK: Record<Lane["status"], number> = {
  researching: 0,
  structuring: 1,
  queued: 2,
  done: 3,
  error: 4,
};

/** Auto-scrolling streaming text box with a blinking caret while active. */
function StreamBox({ text, active, className }: { text: string; active: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <div ref={ref} className={cn("overflow-y-auto whitespace-pre-wrap leading-relaxed", className)}>
      {text}
      {active && <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-accent" />}
    </div>
  );
}

function ToolChips({ tools }: { tools: ToolHit[] }) {
  if (tools.length === 0) return null;
  const recent = tools.slice(-4);
  const offset = tools.length - recent.length;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {recent.map((t, i) => (
        <Tooltip key={offset + i} content={t.sources.length ? t.sources.join(", ") : "searching…"}>
          <span className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[11px] text-accent cursor-help">
            <Search className="h-3.5 w-3.5" />
            <span className="font-medium">Searched:</span>
            <span className="max-w-[240px] truncate text-text-secondary">{t.query ?? "…"}</span>
            {t.sources.length > 0 && <span className="text-text-muted">· {t.sources.length} sources</span>}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

function LaneCard({ l }: { l: Lane }) {
  const active = l.status === "researching" || l.status === "structuring";
  const done = l.status === "done";
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "card flex flex-col p-3.5",
        active && "shadow-glow",
        l.status === "queued" && "opacity-55",
      )}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text">{l.symbol}</span>
          {l.screen && (
            <Badge tone={l.screen === "sentiment" || l.screen === "thematic" ? "accent" : "neutral"}>
              {l.screen}
            </Badge>
          )}
        </div>
        {done && l.action ? (
          <Badge tone={ACTION_TONE[l.action] ?? "neutral"}>
            {l.action} {l.conviction != null ? `· ${(l.conviction * 100).toFixed(0)}%` : ""}
          </Badge>
        ) : l.status === "error" ? (
          <Badge tone="neg">failed</Badge>
        ) : (
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className={cn("h-1.5 w-1.5 rounded-full", active ? "animate-pulse bg-accent" : "bg-text-muted")} />
            {l.status === "researching" ? "researching" : l.status === "structuring" ? "deciding" : "queued"}
          </span>
        )}
      </header>

      {l.thinking && (
        <div className="mb-1.5 flex items-start gap-1.5 text-[11px] italic text-text-muted">
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-accent/70" />
          <StreamBox text={l.thinking} active={active} className="max-h-16 text-text-muted" />
        </div>
      )}

      {(l.text || active) && (
        <StreamBox text={l.text} active={active && !l.thinking} className="max-h-32 text-[12.5px] text-text-secondary" />
      )}
      {l.status === "error" && <p className="text-[11px] text-neg">{l.error}</p>}

      <ToolChips tools={l.tools} />
    </motion.article>
  );
}

export function AnalysisStream({
  runId,
  onFinished,
}: {
  runId: string;
  onFinished: (status: "done" | "error", message?: string) => void;
}) {
  const s = useRunStream(runId, onFinished);
  const pct = s.total > 0 ? Math.round((s.doneCount / s.total) * 100) : 0;
  const lanes = [...s.order.map((sym) => s.lanes.get(sym)!).filter(Boolean)].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status],
  );

  return (
    <div className="space-y-4">
      {/* progress header */}
      <div className="card flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            <span className="text-sm font-medium text-text">{s.phaseLabel}</span>
          </div>
          {s.total > 0 && (
            <span className="tnum text-xs text-text-muted">
              {s.doneCount}/{s.total} done
            </span>
          )}
        </div>
        <div className="h-1 w-full overflow-hidden rounded bg-surface-2">
          <motion.div className="h-full bg-accent" animate={{ width: `${pct}%` }} transition={{ ease: "easeOut" }} />
        </div>
      </div>

      {/* market-context / scan stream */}
      {(s.contextText || s.contextThinking || s.contextTools.length > 0) && (
        <div className="card p-4">
          <div className="eyebrow mb-2">Market read</div>
          {s.contextThinking && (
            <StreamBox text={s.contextThinking} active={s.phase === "context"} className="mb-1.5 max-h-16 text-[11px] italic text-text-muted" />
          )}
          <StreamBox
            text={s.contextText}
            active={s.phase === "context" || s.phase === "scan"}
            className="max-h-28 text-[12.5px] text-text-secondary"
          />
          <ToolChips tools={s.contextTools} />
        </div>
      )}

      {/* parallel ticker lanes */}
      {lanes.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {lanes.map((l) => (
              <LaneCard key={l.symbol} l={l} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {lanes.length === 0 && !s.contextText && (
        <div className="card p-10 text-center text-sm text-text-muted">Spinning up the analysis…</div>
      )}
    </div>
  );
}
