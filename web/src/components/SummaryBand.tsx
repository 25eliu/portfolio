import type { MarketSnapshot, PricedPortfolio, Snapshot } from "../api/types.ts";
import { chart } from "../lib/chartTheme.ts";
import { pct, pnlClass, signedUsd, usd } from "../lib/format.ts";
import { Card } from "./ui/Card.tsx";
import { Sparkline } from "./ui/Sparkline.tsx";
import { Stat } from "./ui/Stat.tsx";

type Props = {
  user: PricedPortfolio;
  ai: PricedPortfolio;
  snapshots?: { user: Snapshot[]; ai: Snapshot[]; spy: MarketSnapshot[] };
};

/** Total return % over the available series (first → last), or null if not enough data. */
function totalReturn(values: number[]): number | null {
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (!first || last == null) return null;
  return (last / first - 1) * 100;
}

export function SummaryBand({ user, ai, snapshots }: Props) {
  const userSeries = (snapshots?.user ?? []).map((s) => s.totalValue);
  const aiSeries = (snapshots?.ai ?? []).map((s) => s.totalValue);
  const spySeries = (snapshots?.spy ?? []).map((s) => s.spyClose);

  const youReturn = totalReturn(userSeries);
  const aiReturn = totalReturn(aiSeries);
  const spyReturn = totalReturn(spySeries);

  const fmtReturn = (r: number | null) => (r == null ? "—" : pct(r));

  return (
    <Card className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 lg:grid-cols-4">
      <Stat
        label="My equity"
        value={usd(user.equity)}
        size="lg"
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
        sub="vs cost basis"
      />
      <Stat
        label="AI equity"
        value={usd(ai.equity)}
        size="lg"
        sub={ai.dayPnL == null ? "—" : `${signedUsd(ai.dayPnL)} today`}
        subTone={pnlClass(ai.dayPnL)}
        trailing={
          <div className="w-20">
            <Sparkline data={aiSeries} color={chart.pos} />
          </div>
        }
      />
      <div>
        <div className="eyebrow">Return · You vs AI vs SPY</div>
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
