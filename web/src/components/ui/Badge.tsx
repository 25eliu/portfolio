import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

type Tone = "neutral" | "accent" | "pos" | "neg" | "warn";

const TONES: Record<Tone, string> = {
  neutral: "border-hairline-strong bg-surface-2 text-text-secondary",
  accent: "border-accent/30 bg-accent/10 text-accent",
  pos: "border-pos/30 bg-pos/10 text-pos",
  neg: "border-neg/30 bg-neg/10 text-neg",
  warn: "border-warn/30 bg-warn/10 text-warn",
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
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
