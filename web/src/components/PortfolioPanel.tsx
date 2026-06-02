import type { PricedPortfolio } from "../api/types.ts";
import { pct, pnlClass, signedUsd, usd } from "../lib/format.ts";
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
  return (
    <Card className="flex flex-col p-5">
      <CardHeader
        title={p.name}
        right={<Badge tone={tone}>{badge}</Badge>}
      />

      <div className="mt-5 grid grid-cols-3 gap-4 border-b border-hairline pb-5">
        <Stat label="Equity" value={usd(p.equity)} display />
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
              <th className="pb-2 text-right font-medium">Day</th>
              <th className="pb-2 text-right font-medium">Value</th>
              <th className="pb-2 text-right font-medium">Total P&L</th>
            </tr>
          </thead>
          <tbody>
            {p.positions.length === 0 && p.cash === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-text-muted">
                  No holdings yet — add positions to mirror your account.
                </td>
              </tr>
            ) : (
              <>
                {p.positions.map((pos) => (
                  <tr
                    key={pos.symbol}
                    className="border-t border-hairline transition-colors hover:bg-surface-2"
                  >
                    <td className="py-2 font-medium text-text">
                      {pos.symbol}
                      {pos.acquiredAt && (
                        <div className="text-xs font-normal text-text-muted">since {pos.acquiredAt}</div>
                      )}
                    </td>
                    <td className="tnum py-2 text-right font-mono text-text-secondary">{pos.shares}</td>
                    <td className="tnum py-2 text-right font-mono text-text-secondary">
                      {usd(pos.price)}
                      {pos.costBasis != null && (
                        <div className="text-xs text-text-muted">avg {usd(pos.costBasis)}</div>
                      )}
                    </td>
                    <PnlCell value={pos.dayPnL} marketValue={pos.marketValue} />
                    <td className="tnum py-2 text-right font-mono text-text">{usd(pos.marketValue)}</td>
                    <PnlCell value={pos.totalPnL} marketValue={pos.marketValue} />
                  </tr>
                ))}
                {p.cash > 0 && (
                  <tr className="border-t border-hairline">
                    <td className="py-2 font-medium text-text-secondary">Cash</td>
                    <td className="py-2 text-right text-text-muted">—</td>
                    <td className="py-2 text-right text-text-muted">—</td>
                    <td className="py-2 text-right text-text-muted">—</td>
                    <td className="tnum py-2 text-right font-mono text-text">{usd(p.cash)}</td>
                    <td className="py-2 text-right text-text-muted">—</td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * A right-aligned per-row P&L cell: signed dollars (colored green/red) with the percentage move
 * beneath. The basis is recovered from `marketValue − value` (= shares × prevClose for the day move,
 * or cost basis for the lifetime move), so no extra fields are needed. Renders "—" when unknown
 * (a freshly-added name with no prior close, or a holding with no cost basis).
 */
function PnlCell({ value, marketValue }: { value: number | null; marketValue: number }) {
  if (value == null) return <td className="py-2 text-right text-text-muted">—</td>;
  const basis = marketValue - value;
  const pctMove = basis > 0 ? (value / basis) * 100 : null;
  return (
    <td className={`tnum py-2 text-right font-mono ${pnlClass(value)}`}>
      <div>{signedUsd(value)}</div>
      {pctMove != null && <div className="text-xs opacity-80">{pct(pctMove)}</div>}
    </td>
  );
}
