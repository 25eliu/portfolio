import type { DailyReport } from "../api/types.ts";
import { Badge } from "./ui/Badge.tsx";

const SPY_TONE: Record<"up" | "down" | "sideways", "pos" | "neg" | "warn"> = {
  up: "pos",
  down: "neg",
  sideways: "warn",
};

const SPY_LABEL: Record<"up" | "down" | "sideways", string> = {
  up: "SPY uptrend",
  down: "SPY downtrend",
  sideways: "SPY sideways",
};

export function MarketContextBanner({ report }: { report: DailyReport | null }) {
  const ctx = report?.marketContext;
  if (!ctx) return null;

  return (
    <article className="card mb-4 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="eyebrow">Market context</span>
        {ctx.spyTrend && (
          <Badge tone={SPY_TONE[ctx.spyTrend]} dot>
            {SPY_LABEL[ctx.spyTrend]}
          </Badge>
        )}
        {ctx.spyPctFromSma200 != null && (
          <span className="text-[11px] text-text-muted">
            {ctx.spyPctFromSma200 >= 0 ? "+" : ""}
            {ctx.spyPctFromSma200.toFixed(1)}% vs 200-day SMA
          </span>
        )}
      </div>

      {ctx.macroSummary && (
        <p className="text-[13px] leading-relaxed text-text-secondary">{ctx.macroSummary}</p>
      )}

      {ctx.sources.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-hairline pt-2">
          {ctx.sources.slice(0, 5).map((s) => {
            let hostname = s.url;
            try { hostname = new URL(s.url).hostname; } catch { /* leave as-is */ }
            return (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-accent hover:underline"
              >
                {s.title || hostname}
              </a>
            );
          })}
        </div>
      )}
    </article>
  );
}
