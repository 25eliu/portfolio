/** Map an AI thesis/outlook stance to a badge tone. Shared by Market view and the journal's
 *  per-day outlook banner so both read the same visual language. */
export const stanceTone = (s: string | null): "pos" | "neg" | "neutral" =>
  s === "bullish" || s === "risk_on"
    ? "pos"
    : s === "bearish" || s === "risk_off" || s === "defensive"
      ? "neg"
      : "neutral";
