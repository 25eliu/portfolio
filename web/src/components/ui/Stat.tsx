import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

/**
 * A single KPI: small label over a large tabular value, with an optional sub line
 * (delta / percentage) and a slot for a sparkline or trailing element.
 */
export function Stat({
  label,
  value,
  sub,
  subTone = "text-text-secondary",
  valueTone = "text-text",
  size = "md",
  trailing,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  subTone?: string;
  valueTone?: string;
  size?: "sm" | "md" | "lg";
  trailing?: ReactNode;
  className?: string;
}) {
  const valueSize =
    size === "lg" ? "text-2xl" : size === "md" ? "text-lg" : "text-base";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className={cn("tnum font-semibold leading-tight", valueSize, valueTone)}>
            {value}
          </div>
          {sub != null && <div className={cn("tnum mt-0.5 text-xs", subTone)}>{sub}</div>}
        </div>
        {trailing}
      </div>
    </div>
  );
}
