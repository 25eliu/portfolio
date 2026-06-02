import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

const VARIANTS: Record<Variant, string> = {
  // Solid accent key.
  primary: "bg-accent text-canvas font-semibold hover:bg-accent-strong",
  // Solid elevated surface with a hairline border.
  secondary:
    "border border-hairline bg-surface-2 text-text hover:bg-surface-3 hover:border-hairline-strong",
  ghost: "text-text-secondary hover:bg-surface-2 hover:text-text",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  disabled,
  className,
  children,
  ...props
}: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
