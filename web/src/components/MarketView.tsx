import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AiInsight } from "../api/client.ts";
import { useMarketViewCurrent, useMarketViewSubject } from "../api/hooks.ts";
import { cn } from "../lib/cn.ts";
import { Badge } from "./ui/Badge.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";

const stanceTone = (s: string | null): "pos" | "neg" | "neutral" =>
  s === "bullish" || s === "risk_on" ? "pos" : s === "bearish" || s === "risk_off" || s === "defensive" ? "neg" : "neutral";

/** The AI's current market outlook: regime banner + sector leans + named themes, each with its evolution. */
export function MarketView() {
  const mv = useMarketViewCurrent();
  if (mv.isLoading) return <Skeleton className="h-40 w-full" />;
  const regime = mv.data?.regime ?? null;
  const sectors = mv.data?.sectors ?? [];
  const themes = mv.data?.themes ?? [];
  if (!regime && sectors.length === 0 && themes.length === 0) {
    return (
      <div className="card p-6">
        <p className="rounded-xl border border-dashed border-hairline p-6 text-center text-[12px] text-text-muted">
          No outlook yet — the next analysis run will author the AI's market regime, sector leans, and themes here.
        </p>
      </div>
    );
  }
  return (
    <div className="card p-6">
      {regime && (
        <article className="glass mb-4 p-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="eyebrow">Market regime</span>
            <Badge tone={stanceTone(regime.stance)} dot>{regime.stance}</Badge>
            {regime.conviction != null && <span className="text-[11px] text-text-muted">conviction {regime.conviction.toFixed(2)} · {regime.horizon}</span>}
          </div>
          <p className="text-[13px] leading-relaxed text-text-secondary">{regime.body || regime.headline}</p>
        </article>
      )}
      {sectors.length > 0 && <Group title="Sector leans" items={sectors} />}
      {themes.length > 0 && <Group title="Themes" items={themes} />}
    </div>
  );
}

function Group({ title, items }: { title: string; items: AiInsight[] }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-text-muted">{title}</p>
      <div className="divide-y divide-hairline">
        {items.map((i) => <Lean key={i.id} insight={i} />)}
      </div>
    </div>
  );
}

function Lean({ insight }: { insight: AiInsight }) {
  const [open, setOpen] = useState(false);
  const history = useMarketViewSubject(open ? insight.level : null, open ? insight.subject : null);
  return (
    <div className="py-2">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
        <span className="font-medium text-text">{insight.subject}</span>
        <Badge tone={stanceTone(insight.stance)}>{insight.stance}</Badge>
        {insight.conviction != null && <span className="text-[11px] text-text-muted">{insight.conviction.toFixed(2)} · {insight.horizon}</span>}
        {insight.tickers.length > 0 && <span className="ml-auto text-[10px] text-text-muted">{insight.tickers.join(" · ")}</span>}
      </button>
      {open && (
        <div className="border-l border-hairline pl-3 pt-2">
          <p className="text-[13px] leading-snug text-text-secondary">{insight.body}</p>
          {(history.data?.history ?? []).length > 1 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">How this view evolved</p>
              {(history.data?.history ?? []).map((h) => (
                <div key={h.id} className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span>{h.date}</span><Badge tone={stanceTone(h.stance)}>{h.stance}</Badge>
                  <span>{h.conviction?.toFixed(2)}</span>
                  {h.status !== "active" && <span className="opacity-60">({h.status})</span>}
                </div>
              ))}
            </div>
          )}
          {insight.sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3">
              {insight.sources.slice(0, 5).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">{s.title}</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
