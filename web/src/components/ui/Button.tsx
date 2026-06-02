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
  // A "lit glass key" — top-down gradient with an inset specular highlight.
  primary:
    "bg-gradient-to-b from-accent-strong to-accent text-canvas font-semibold hover:to-accent-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_6px_18px_-6px_rgba(79,141,253,0.65)]",
  // Frosted glass surface — translucent, blurred over whatever sits behind it.
  secondary:
    "border border-glass-edge bg-glass-tint text-text backdrop-blur-md hover:border-glass-edge-strong hover:bg-surface-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
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
