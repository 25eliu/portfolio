import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

/**
 * Radix Dialog wrapper — focus trap, ESC-to-close, blurred overlay, animated entrance.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-[fade-up_0.2s_ease-out]" />
        <RadixDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl border border-hairline-strong bg-surface p-6 shadow-pop outline-none",
            "data-[state=open]:animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]",
            className,
          )}
        >
          <header className="mb-5 flex items-start justify-between gap-3">
            <div>
              <RadixDialog.Title className="text-lg font-semibold text-text">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-0.5 text-xs text-text-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              className="rounded-lg p-1 text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
              aria-label="Close"
            >
              <X className="h-[18px] w-[18px]" />
            </RadixDialog.Close>
          </header>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
