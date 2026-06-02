import type { Action } from "../domain/index.ts";

const HELD = new Set<Action>(["ADD", "TRIM", "HOLD", "SELL"]);
const CANDIDATE = new Set<Action>(["BUY", "WATCH", "PASS"]);

/** Coerce a model-returned action into the verb set valid for the position context. */
export function normalizeAction(raw: string, held: boolean): Action {
  const a = raw as Action;
  if (held) {
    if (HELD.has(a)) return a;
    return ({ BUY: "ADD", WATCH: "HOLD", PASS: "HOLD" } as Record<string, Action>)[raw] ?? "HOLD";
  }
  if (CANDIDATE.has(a)) return a;
  return ({ ADD: "BUY", HOLD: "PASS", TRIM: "PASS", SELL: "PASS" } as Record<string, Action>)[raw] ?? "PASS";
}
