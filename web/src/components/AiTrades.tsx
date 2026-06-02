import type { TradeAction, TradeStatus } from "../api/types.ts";
import { useTrades } from "../api/hooks.ts";
import { usd } from "../lib/format.ts";
import { Badge } from "./ui/Badge.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";

const ACTION_TONE: Record<TradeAction, "pos" | "neg"> = { BUY: "pos", ADD: "pos", TRIM: "neg", SELL: "neg" };
const STATUS_TONE: Record<TradeStatus, "pos" | "neg" | "accent" | "neutral" | "warn"> = {
  filled: "pos",
  submitted: "accent",
  proposed: "neutral",
  skipped: "warn",
  failed: "neg",
};

/** Region 4 (trades) — the AI's own paper-trade log. The AI trades automatically on every run. */
export function AiTrades() {
  const trades = useTrades();
  const rows = trades.data?.trades ?? [];

  return (
    <div className="space-y-3">
      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2">
          <p className="text-sm font-medium text-text-secondary">AI trades</p>
          {rows.length > 0 && <Badge tone="neutral">{rows.length}</Badge>}
          <Badge tone="pos" dot>paper · auto</Badge>
          <span className="ml-auto text-[11px] text-text-muted">the AI's own decisions, from the same analysis</span>
        </div>

        {trades.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-hairline p-6 text-center text-[12px] text-text-muted">
            No trades yet — the AI trades automatically on each analysis run, and its trades will appear here.
          </div>
        ) : (
          <div className="divide-y divide-hairline">
            {rows.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2.5">
                <span className="w-14 font-semibold tracking-tight text-text">{t.ticker}</span>
                <Badge tone={ACTION_TONE[t.action]}>{t.action}</Badge>
                {t.qty > 0 && (
                  <span className="tnum text-[11px] text-text-secondary">
                    {t.qty} @ {usd(t.intendedPrice)}
                  </span>
                )}
                <span className="flex-1 truncate text-[11px] text-text-muted">{t.reason}</span>
                <Badge tone={STATUS_TONE[t.status]} dot>
                  {t.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
