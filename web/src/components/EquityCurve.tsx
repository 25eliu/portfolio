import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MarketSnapshot, Snapshot } from "../api/types.ts";
import { cn } from "../lib/cn.ts";
import { chart, tooltipStyle } from "../lib/chartTheme.ts";
import { pct } from "../lib/format.ts";
import { type HorizonKey, horizonDays, latestDate, withinHorizon } from "../lib/horizon.ts";
import { cumulativeReturnSeries } from "../lib/performance.ts";
import { TimeHorizon } from "./ui/TimeHorizon.tsx";

type SeriesData = { user: Snapshot[]; ai: Snapshot[]; spy: MarketSnapshot[] };
type Props = SeriesData & {
  horizon: HorizonKey;
  onHorizonChange: (h: HorizonKey) => void;
};
type SeriesKey = "you" | "ai" | "spy";

const SERIES: { key: SeriesKey; name: string; color: string; dashed?: boolean }[] = [
  { key: "you", name: "You", color: chart.accent },
  { key: "ai", name: "AI", color: chart.pos },
  { key: "spy", name: "SPY", color: chart.muted, dashed: true },
];

/**
 * Build a merged, date-aligned series of cumulative % return for You / AI / SPY, rebased to the
 * selected window. Each series is windowed FIRST, then normalized to start at 0% on the window's
 * opening date — so the chart re-bases whenever the horizon changes and every line sits on one
 * comparable percent axis. You/AI use time-weighted return (contribution-neutral, so deposits and
 * added positions never read as performance); SPY is a plain price move off its first windowed close.
 */
function buildSeries({ user, ai, spy }: SeriesData, horizon: HorizonKey) {
  const days = horizonDays(horizon);
  const ref = latestDate(user, ai, spy);
  const userWin = withinHorizon(user, days, ref);
  const aiWin = withinHorizon(ai, days, ref);
  const spyWin = withinHorizon(spy, days, ref);

  const u = new Map(cumulativeReturnSeries(userWin).map((p) => [p.date, p.value]));
  const a = new Map(cumulativeReturnSeries(aiWin).map((p) => [p.date, p.value]));
  const firstSpy = spyWin[0]?.spyClose;
  const s = new Map(
    firstSpy ? spyWin.map((r) => [r.date, (r.spyClose / firstSpy - 1) * 100]) : [],
  );

  const dates = [...new Set([...userWin, ...aiWin, ...spyWin].map((r) => r.date))].sort();
  return dates.map((date) => ({
    date,
    you: u.get(date) ?? null,
    ai: a.get(date) ?? null,
    spy: s.get(date) ?? null,
  }));
}

function CurveTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const get = (k: SeriesKey) => payload.find((p: any) => p.dataKey === k)?.value as number | null;
  const you = get("you");
  const spy = get("spy");
  // Both are already cumulative % returns, so the gap is a percentage-point spread, not a ratio.
  const delta = you != null && spy != null ? you - spy : null;

  return (
    <div style={tooltipStyle} className="min-w-[180px]">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <div className="space-y-1.5">
        {SERIES.map((s) => {
          const v = get(s.key);
          if (v == null) return null;
          return (
            <div key={s.key} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex items-center gap-2 text-text-secondary">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="tnum font-medium text-text">{pct(v)}</span>
            </div>
          );
        })}
      </div>
      {delta != null && (
        <div className="mt-2 border-t border-hairline pt-2 text-[11px] text-text-muted">
          vs SPY{" "}
          <span className={cn("tnum font-medium", delta >= 0 ? "text-pos" : "text-neg")}>
            {pct(delta)}
          </span>
        </div>
      )}
    </div>
  );
}

export function EquityCurve({ horizon, onHorizonChange, ...props }: Props) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const data = useMemo(() => buildSeries(props, horizon), [props, horizon]);

  const toggle = (key: SeriesKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (data.length < 1) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm text-text-secondary">No equity history yet</p>
        <p className="text-xs text-text-muted">
          Run the analysis to start plotting You vs AI vs SPY.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {SERIES.map((s) => {
            const off = hidden.has(s.key);
            return (
              <button
                key={s.key}
                onClick={() => toggle(s.key)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-hairline px-2.5 py-1 text-xs transition-colors",
                  off ? "text-text-muted opacity-50" : "text-text-secondary hover:border-hairline-strong",
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: s.color, opacity: off ? 0.4 : 1 }}
                />
                {s.name}
              </button>
            );
          })}
        </div>
        <TimeHorizon value={horizon} onChange={onHorizonChange} />
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="eq-you" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chart.accent} stopOpacity={0.22} />
              <stop offset="100%" stopColor={chart.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={chart.grid} vertical={false} />
          <XAxis
            dataKey="date"
            stroke={chart.axis}
            fontSize={11}
            tickMargin={10}
            tickLine={false}
            axisLine={{ stroke: chart.grid }}
            minTickGap={40}
          />
          <YAxis
            stroke={chart.axis}
            fontSize={11}
            width={56}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => pct(v)}
            domain={["auto", "auto"]}
          />
          <ReferenceLine y={0} stroke={chart.grid} strokeWidth={1} />
          <Tooltip
            content={<CurveTooltip />}
            cursor={{ stroke: chart.hairline, strokeWidth: 1, strokeDasharray: "4 4" }}
          />
          {!hidden.has("you") && (
            <Area
              type="monotone"
              dataKey="you"
              stroke={chart.accent}
              strokeWidth={2.25}
              fill="url(#eq-you)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
            />
          )}
          {!hidden.has("ai") && (
            <Line
              type="monotone"
              dataKey="ai"
              stroke={chart.pos}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
              connectNulls
            />
          )}
          {!hidden.has("spy") && (
            <Line
              type="monotone"
              dataKey="spy"
              stroke={chart.muted}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0 }}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
