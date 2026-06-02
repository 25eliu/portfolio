import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { cn } from "../../lib/cn.ts";

type Option<T extends string> = { value: T; label: string };

/**
 * Accessible segmented control (Radix ToggleGroup) — replaces raw <select> for small,
 * mutually-exclusive option sets (risk preset, recommendation filter).
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  size?: "sm" | "md";
  className?: string;
}) {
  const pad = size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs";
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-xl border border-hairline bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((opt) => (
        <ToggleGroup.Item
          key={opt.value}
          value={opt.value}
          className={cn(
            "rounded-lg font-medium capitalize text-text-secondary transition-colors",
            "hover:text-text data-[state=on]:bg-accent data-[state=on]:text-canvas",
            pad,
          )}
        >
          {opt.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
