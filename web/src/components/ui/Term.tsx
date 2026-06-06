import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip.tsx";
import { GLOSSARY } from "../../lib/glossary.ts";

/**
 * Wraps a label in a dotted-underline hover tooltip with the plain-English definition from the glossary.
 * If the key isn't in the glossary it renders the children unchanged (no decoration), so it's always
 * safe to wrap. Shared across the dashboard so jargon (R, Brier, expectancy, MFE/MAE…) is explained
 * consistently wherever it appears.
 */
export function Term({ k, children }: { k: string; children: ReactNode }) {
  const def = GLOSSARY[k];
  if (!def) return <>{children}</>;
  return (
    <Tooltip content={def}>
      <span className="cursor-help underline decoration-dotted decoration-text-muted underline-offset-2">
        {children}
      </span>
    </Tooltip>
  );
}
