import { useState } from "react";
import type { Action, DailyReport } from "../api/types.ts";
import { Badge } from "./ui/Badge.tsx";
import { SegmentedControl } from "./ui/SegmentedControl.tsx";
import { RecommendationCard } from "./RecommendationCard.tsx";

const SECTIONS: { title: string; actions: Action[] }[] = [
  { title: "Buy", actions: ["BUY", "ADD"] },
  { title: "Sell / Trim", actions: ["SELL", "TRIM"] },
  { title: "Hold", actions: ["HOLD"] },
  { title: "Watch", actions: ["WATCH"] },
];

type Filter = "all" | Action;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "BUY", label: "Buy" },
  { value: "SELL", label: "Sell" },
  { value: "HOLD", label: "Hold" },
  { value: "WATCH", label: "Watch" },
];

const byConviction = (a: { conviction: number }, b: { conviction: number }) =>
  b.conviction - a.conviction;

export function Recommendations({ report }: { report: DailyReport | null }) {
  const [filter, setFilter] = useState<Filter>("all");

  if (!report || report.recommendations.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center gap-1.5 p-10 text-center">
        <p className="text-sm text-text-secondary">No recommendations yet</p>
        <p className="text-xs text-text-muted">
          Run the analysis to generate today's report.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <SegmentedControl value={filter} onChange={setFilter} options={FILTERS} size="sm" />
      </div>

      {filter === "all" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {SECTIONS.map(({ title, actions }) => {
            const cards = report.recommendations
              .filter((r) => actions.includes(r.action))
              .sort(byConviction);
            return (
              <div key={title} className="flex flex-col gap-3">
                <h3 className="flex items-center gap-2">
                  <span className="eyebrow">{title}</span>
                  <Badge tone="neutral">{cards.length}</Badge>
                </h3>
                {cards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-hairline p-4 text-center text-[11px] text-text-muted">
                    None
                  </div>
                ) : (
                  cards.map((r) => <RecommendationCard key={r.ticker} r={r} />)
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {report.recommendations
            .filter((r) => r.action === filter)
            .sort(byConviction)
            .map((r) => (
              <RecommendationCard key={r.ticker} r={r} />
            ))}
        </div>
      )}
    </div>
  );
}
