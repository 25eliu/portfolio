import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export function Card({
  className,
  children,
  as: Tag = "section",
  variant = "solid",
}: {
  className?: string;
  children: ReactNode;
  as?: "section" | "article" | "div";
  /** "glass" for hero/chrome surfaces; "solid" (default) for data-dense panels. */
  variant?: "solid" | "glass";
}) {
  return <Tag className={cn(variant === "glass" ? "glass" : "card", className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  eyebrow,
  right,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-3", className)}>
      <div>
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h2 className="text-[15px] font-semibold text-text">{title}</h2>
      </div>
      {right}
    </header>
  );
}
