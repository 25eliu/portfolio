import type { PricedPortfolio } from "../api/types.ts";
import { pctRaw, pnlClass, signedUsd, usd } from "../lib/format.ts";
import { AllocationDonut } from "./AllocationDonut.tsx";
import { Badge } from "./ui/Badge.tsx";
import { Card, CardHeader } from "./ui/Card.tsx";
import { Stat } from "./ui/Stat.tsx";

export function PortfolioPanel({
  p,
  badge,
  tone = "accent",
}: {
  p: PricedPortfolio;
  badge: string;
  tone?: "accent" | "pos";
}) {
  const equity = p.equity || 0;

  return (
    <Card className="flex flex-col p-5">
      <CardHeader
        title={p.name}
        right={<Badge tone={tone}>{badge}</Badge>}
      />

      <div className="mt-5 grid grid-cols-3 gap-4 border-b border-hairline pb-5">
        <Stat label="Equity" value={usd(p.equity)} />
        <Stat
          label="Total P&L"
          value={signedUsd(p.totalPnL)}
          valueTone={pnlClass(p.totalPnL)}
        />
        <Stat
          label="Day P&L"
          value={p.dayPnL == null ? "—" : signedUsd(p.dayPnL)}
          valueTone={pnlClass(p.dayPnL)}
        />
      </div>

      <div className="py-5">
        <AllocationDonut positions={p.positions} />
      </div>

      <div className="mt-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="eyebrow text-left">
              <th className="pb-2 font-medium">Symbol</th>
              <th className="pb-2 text-right font-medium">Shares</th>
              <th className="pb-2 text-right font-medium">Price</th>
              <th className="pb-2 text-right font-medium">Value</th>
              <th className="pb-2 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {p.positions.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-sm text-text-muted">
                  No holdings yet — add positions to mirror your account.
                </td>
              </tr>
            ) : (
              p.positions.map((pos) => (
                <tr
                  key={pos.symbol}
                  className="border-t border-hairline transition-colors hover:bg-surface-2"
                >
                  <td className="py-2 font-medium text-text">{pos.symbol}</td>
                  <td className="tnum py-2 text-right font-mono text-text-secondary">{pos.shares}</td>
                  <td className="tnum py-2 text-right font-mono text-text-secondary">
                    {usd(pos.price)}
                  </td>
                  <td className="tnum py-2 text-right font-mono text-text">{usd(pos.marketValue)}</td>
                  <td className="tnum py-2 text-right font-mono text-text-muted">
                    {equity > 0 ? pctRaw((pos.marketValue / equity) * 100) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
