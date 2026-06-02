import type { MarketSnapshot, PricedPortfolio, Snapshot } from "../api/types.ts";
import { chart } from "../lib/chartTheme.ts";
import { pct, pnlClass, signedUsd, usd } from "../lib/format.ts";
import { type HorizonKey, horizonDays, latestDate, periodReturn, withinHorizon } from "../lib/horizon.ts";
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

  // All three returns are the % move over the selected window, so they respond to the horizon.
  const days = horizonDays(horizon);
  const ref = latestDate(userSnaps, aiSnaps, spySnaps);
  const userSeries = withinHorizon(userSnaps, days, ref).map(stockValue);
  const aiSeries = withinHorizon(aiSnaps, days, ref).map(stockValue);
  const spySeries = withinHorizon(spySnaps, days, ref).map((s) => s.spyClose);

  const youReturn = periodReturn(userSeries);
  const aiReturn = periodReturn(aiSeries);
  const spyReturn = periodReturn(spySeries);

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
