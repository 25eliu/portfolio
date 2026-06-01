import { cn } from "../../lib/cn.ts";

/** Shimmer placeholder for loading states (replaces plain "Loading…" text). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-lg bg-[length:200%_100%]",
        "bg-[linear-gradient(90deg,#181C22_0%,#222831_50%,#181C22_100%)]",
        className,
      )}
    />
  );
}
