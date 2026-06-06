import type { PricedPortfolio } from "../api/types.ts";
import { fmtDayPnL, fmtTotalPnL, pct, pnlClass, signedUsd, usd, type PnlMode } from "../lib/format.ts";
import { AllocationDonut } from "./AllocationDonut.tsx";
import { Badge } from "./ui/Badge.tsx";
import { Card, CardHeader } from "./ui/Card.tsx";
import { Stat } from "./ui/Stat.tsx";

export function PortfolioPanel({
  p,
  badge,
  tone = "accent",
  pnlMode,
}: {
  p: PricedPortfolio;
  badge: string;
  tone?: "accent" | "pos";
  pnlMode: PnlMode;
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
          value={fmtTotalPnL(p.totalPnL, p.costValue, pnlMode)}
          valueTone={pnlClass(p.totalPnL)}
        />
        <Stat
          label="Day P&L"
          value={fmtDayPnL(p.dayPnL, p.equity, pnlMode)}
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
                    <PnlCell value={pos.dayPnL} marketValue={pos.marketValue} mode={pnlMode} />
                    <td className="tnum py-2 text-right font-mono text-text">{usd(pos.marketValue)}</td>
                    <PnlCell value={pos.totalPnL} marketValue={pos.marketValue} mode={pnlMode} />
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
 * A right-aligned per-row P&L cell showing both the signed dollars (colored green/red) and the
 * percentage move; `mode` decides which is the headline and which the subtext. The basis is
 * recovered from `marketValue − value` (= shares × prevClose for the day move, or cost basis for
 * the lifetime move), so no extra fields are needed. Renders "—" when unknown (a freshly-added
 * name with no prior close, or a holding with no cost basis), and falls back to dollars when a
 * percentage can't be derived even in % mode.
 */
function PnlCell({
  value,
  marketValue,
  mode,
}: {
  value: number | null;
  marketValue: number;
  mode: PnlMode;
}) {
  if (value == null) return <td className="py-2 text-right text-text-muted">—</td>;
  const basis = marketValue - value;
  const pctMove = basis > 0 ? (value / basis) * 100 : null;
  const dollars = signedUsd(value);
  const percent = pctMove != null ? pct(pctMove) : null;
  const showPct = mode === "pct" && percent != null;
  const primary = showPct ? percent : dollars;
  const secondary = showPct ? dollars : percent;
  return (
    <td className={`tnum py-2 text-right font-mono ${pnlClass(value)}`}>
      <div>{primary}</div>
      {secondary != null && <div className="text-xs opacity-80">{secondary}</div>}
    </td>
  );
}
