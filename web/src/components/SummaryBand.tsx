import type { MarketSnapshot, PricedPortfolio, Snapshot } from "../api/types.ts";
import { chart } from "../lib/chartTheme.ts";
import { pct, pnlClass, signedUsd, usd } from "../lib/format.ts";
import { type HorizonKey, horizonDays, latestDate, periodReturn, withinHorizon } from "../lib/horizon.ts";
import { timeWeightedReturn } from "../lib/performance.ts";
import { Card } from "./ui/Card.tsx";
import { Sparkline } from "./ui/Sparkline.tsx";
import { Stat } from "./ui/Stat.tsx";
import { TimeHorizon } from "./ui/TimeHorizon.tsx";

type Props = {
  user: PricedPortfolio;
  ai: PricedPortfolio;
  snapshots?: { user: Snapshot[]; ai: Snapshot[]; spy: MarketSnapshot[] };
  horizon: HorizonKey;
  onHorizonChange: (h: HorizonKey) => void;
};

/** Stock value of a snapshot (cash excluded) so cash deposits don't read as performance. */
const stockValue = (s: Snapshot) => s.totalValue - s.cash;

export function SummaryBand({ user, ai, snapshots, horizon, onHorizonChange }: Props) {
  const userSnaps = snapshots?.user ?? [];
  const aiSnaps = snapshots?.ai ?? [];
  const spySnaps = snapshots?.spy ?? [];

  // Returns are P&L over the selected window — contribution-neutral for You/AI (time-weighted, so
  // adding stocks or cash never counts), and a plain price move for SPY (it has no contributions).
  const days = horizonDays(horizon);
  const ref = latestDate(userSnaps, aiSnaps, spySnaps);
  const userWin = withinHorizon(userSnaps, days, ref);
  const aiWin = withinHorizon(aiSnaps, days, ref);

  const youReturn = timeWeightedReturn(userWin);
  const aiReturn = timeWeightedReturn(aiWin);
  const spyReturn = periodReturn(withinHorizon(spySnaps, days, ref).map((s) => s.spyClose));

  // Sparklines track stock value (cash excluded) so cash deposits don't read as performance.
  const userSeries = userWin.map(stockValue);
  const aiSeries = aiWin.map(stockValue);

  const fmtReturn = (r: number | null) => (r == null ? "—" : pct(r));

  return (
    <Card className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 lg:grid-cols-4">
      <Stat
        label="My equity"
        value={usd(user.equity)}
        size="lg"
        display
        sub={user.dayPnL == null ? "—" : `${signedUsd(user.dayPnL)} today`}
        subTone={pnlClass(user.dayPnL)}
        trailing={
          <div className="w-20">
            <Sparkline data={userSeries} color={chart.accent} />
          </div>
        }
      />
      <Stat
        label="Total P&L"
        value={signedUsd(user.totalPnL)}
        valueTone={pnlClass(user.totalPnL)}
        size="lg"
        display
        sub="vs cost basis"
      />
      <Stat
        label="AI equity"
        value={usd(ai.equity)}
        size="lg"
        display
        sub={ai.dayPnL == null ? "—" : `${signedUsd(ai.dayPnL)} today`}
        subTone={pnlClass(ai.dayPnL)}
        trailing={
          <div className="w-20">
            <Sparkline data={aiSeries} color={chart.pos} />
          </div>
        }
      />
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="eyebrow">Return · You vs AI vs SPY</div>
          <TimeHorizon value={horizon} onChange={onHorizonChange} />
        </div>
        <div className="mt-2 space-y-1.5">
          <ReturnRow label="You" value={fmtReturn(youReturn)} raw={youReturn} color={chart.accent} />
          <ReturnRow label="AI" value={fmtReturn(aiReturn)} raw={aiReturn} color={chart.pos} />
          <ReturnRow label="SPY" value={fmtReturn(spyReturn)} raw={spyReturn} color={chart.muted} />
        </div>
      </div>
    </Card>
  );
}

function ReturnRow({
  label,
  value,
  raw,
  color,
}: {
  label: string;
  value: string;
  raw: number | null;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2 text-text-secondary">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className={`tnum font-medium ${pnlClass(raw)}`}>{value}</span>
    </div>
  );
}
