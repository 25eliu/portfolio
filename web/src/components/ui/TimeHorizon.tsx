import { cn } from "../../lib/cn.ts";
import { HORIZONS, type HorizonKey } from "../../lib/horizon.ts";

/** Shared 1W / 1M / 3M / 1Y / All selector. Drives both the equity curve and the return stats. */
export function TimeHorizon({
  value,
  onChange,
  className,
}: {
  value: HorizonKey;
  onChange: (key: HorizonKey) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Time horizon"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-xl border border-hairline bg-surface-2 p-0.5",
        className,
      )}
    >
      {HORIZONS.map((h) => (
        <button
          key={h.key}
          role="tab"
          aria-selected={value === h.key}
          onClick={() => onChange(h.key)}
          className={cn(
            "rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
            value === h.key ? "bg-accent text-canvas" : "text-text-secondary hover:text-text",
          )}
        >
          {h.key}
        </button>
      ))}
    </div>
  );
}
