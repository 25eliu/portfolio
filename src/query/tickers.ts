import type { App } from "../app.ts";

/** Where a mentionable ticker comes from — drives the grouped `@`-autocomplete in the UI. */
export type MentionSource = "holding" | "ai" | "watchlist";
export type MentionTicker = { symbol: string; sources: MentionSource[] };

const SOURCE_ORDER: MentionSource[] = ["holding", "ai", "watchlist"];

/**
 * The set of tickers the owner can `@`-mention: their own holdings, the AI book's holdings + open
 * theses, and the watchlist — each tagged with every source it appears in (a symbol can be in several).
 * Pure read over the repos; sorted by symbol for a stable picker.
 */
export function mentionableTickers(app: App): MentionTicker[] {
  const sources = new Map<string, Set<MentionSource>>();
  const add = (symbol: string, source: MentionSource) => {
    const sym = symbol.toUpperCase();
    const set = sources.get(sym) ?? new Set<MentionSource>();
    set.add(source);
    sources.set(sym, set);
  };

  for (const h of app.repos.holdings.listByPortfolio(app.user.id)) add(h.symbol, "holding");
  for (const h of app.repos.holdings.listByPortfolio(app.ai.id)) add(h.symbol, "ai");
  for (const f of app.repos.scoredForecasts.listOpen(app.now())) add(f.ticker, "ai");
  for (const w of app.repos.watchlist.list()) add(w.symbol, "watchlist");

  return [...sources.entries()]
    .map(([symbol, set]) => ({ symbol, sources: SOURCE_ORDER.filter((s) => set.has(s)) }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Extract `@TICKER` mentions from free text (e.g. "how is @NVDA vs @AAPL?"). Uppercased + de-duped.
 * Used server-side as the authoritative parse so focus-scoping holds even if the client omits tickers.
 */
export function parseMentions(text: string): string[] {
  const out = new Set<string>();
  // `(?<!\w)` skips emails (the @ in "a@b.com"); trailing dots from sentence punctuation are trimmed,
  // while a mid-symbol dot like BRK.B is kept.
  for (const m of text.matchAll(/(?<!\w)@([A-Za-z][A-Za-z.]{0,9})/g)) {
    const sym = m[1]?.replace(/\.+$/, "").toUpperCase();
    if (sym) out.add(sym);
  }
  return [...out];
}
