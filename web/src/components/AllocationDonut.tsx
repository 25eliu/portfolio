import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { PricedPosition } from "@shared/domain/index.ts";
import { seriesColor, tooltipStyle } from "../lib/chartTheme.ts";
import { compactUsd, pctRaw, usd } from "../lib/format.ts";

function DonutTooltip({ active, payload, total }: any) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  const weight = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={tooltipStyle}>
      <div className="text-xs font-medium text-text">{name}</div>
      <div className="tnum mt-0.5 text-xs text-text-secondary">
        {usd(value)} · {pctRaw(weight)}
      </div>
    </div>
  );
}

export function AllocationDonut({ positions }: { positions: PricedPosition[] }) {
  const [active, setActive] = useState<number | null>(null);
  const data = positions
    .filter((p) => p.marketValue > 0)
    .map((p) => ({ name: p.symbol, value: p.marketValue }))
    .sort((a, b) => b.value - a.value);

  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-text-muted">
        No positions to allocate
      </div>
    );
  }

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={52}
              outerRadius={72}
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="none"
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {data.map((_, i) => (
                <Cell
                  key={i}
                  fill={seriesColor(i)}
                  opacity={active == null || active === i ? 1 : 0.35}
                  style={{ transition: "opacity 0.15s" }}
                />
              ))}
            </Pie>
            <Tooltip content={<DonutTooltip total={total} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="eyebrow">Value</span>
          <span className="tnum text-sm font-semibold text-text">{compactUsd(total)}</span>
          <span className="mt-0.5 text-[10px] text-text-muted">
            {data.length} {data.length === 1 ? "position" : "positions"}
          </span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.slice(0, 6).map((d, i) => (
          <li
            key={d.name}
            className="flex items-center justify-between gap-2 text-xs"
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: seriesColor(i) }}
              />
              <span className="truncate font-medium text-text-secondary">{d.name}</span>
            </span>
            <span className="tnum shrink-0 text-text-muted">
              {pctRaw(total > 0 ? (d.value / total) * 100 : 0)}
            </span>
          </li>
        ))}
        {data.length > 6 && (
          <li className="text-[11px] text-text-muted">+{data.length - 6} more</li>
        )}
      </ul>
    </div>
  );
}
