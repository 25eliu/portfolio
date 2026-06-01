import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function Tooltip({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactNode;
}) {
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={6}
            className="z-50 max-w-xs rounded-lg border border-hairline-strong bg-surface-2 px-2.5 py-1.5 text-xs text-text-secondary shadow-pop data-[state=delayed-open]:animate-[fade-up_0.15s_ease-out]"
          >
            {content}
            <RadixTooltip.Arrow className="fill-surface-2" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
