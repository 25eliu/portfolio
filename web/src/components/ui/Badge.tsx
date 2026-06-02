import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

type Tone = "neutral" | "accent" | "pos" | "neg" | "warn";

const TONES: Record<Tone, string> = {
  neutral: "border-hairline bg-surface-2 text-text-secondary",
  accent: "border-hairline bg-surface-2 text-accent",
  pos: "border-hairline bg-surface-2 text-pos",
  neg: "border-hairline bg-surface-2 text-neg",
  warn: "border-hairline bg-surface-2 text-warn",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium",
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
