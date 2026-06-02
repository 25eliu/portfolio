import type { Action, DailyReport, Recommendation } from "../api/types.ts";
import { Badge } from "./ui/Badge.tsx";
import { RecommendationCard } from "./RecommendationCard.tsx";

const HELD_ORDER: Action[] = ["SELL", "TRIM", "ADD", "HOLD"];
const OPP_ORDER: Action[] = ["BUY", "WATCH"];

const rank = (order: Action[]) => (r: Recommendation) => {
  const i = order.indexOf(r.action);
  return (i < 0 ? 99 : i) - r.conviction; // action group first, then conviction desc
};

function Group({
  title,
  subtitle,
  recs,
}: {
  title: string;
  subtitle: string;
  recs: Recommendation[];
}) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <span className="eyebrow">{title}</span>
        <Badge tone="neutral">{recs.length}</Badge>
        <span className="text-[11px] text-text-muted">{subtitle}</span>
      </div>
      {recs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline p-5 text-center text-[11px] text-text-muted">
          None
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {recs.map((r) => (
            <RecommendationCard key={r.ticker} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Recommendations({ report }: { report: DailyReport | null }) {
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

  const held = report.recommendations
    .filter((r) => r.held)
    .sort((a, b) => rank(HELD_ORDER)(a) - rank(HELD_ORDER)(b));

  const opp = report.recommendations
    .filter((r) => !r.held)
    .sort((a, b) => rank(OPP_ORDER)(a) - rank(OPP_ORDER)(b));

  return (
    <div>
      <Group
        title="Your positions"
        subtitle="what to do with what you own"
        recs={held}
      />
      <Group
        title="Opportunities"
        subtitle="ideas you don't own yet"
        recs={opp}
      />
    </div>
  );
}
