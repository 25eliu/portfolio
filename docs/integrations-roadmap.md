# Data Integrations Roadmap — sharpening the prediction LLM

> **Status.** This is a planning menu, **not** an implementation. Each integration below becomes its
> own spec → plan → build cycle. Scope is **free / keyless sources only** — paid feeds are explicitly
> out of scope (see the dedicated section). Companion to
> [`architecture-and-roadmap.md`](architecture-and-roadmap.md).

## A. Goal & non-goals

**Goal.** Add **orthogonal** predictive signal to the daily forecast — signal the current
technicals / fundamentals / macro / analyst stack does **not** already carry. Today the structure
prompt (`buildTickerStructurePrompt`, `src/llm/prompts.ts`) is fed by: market regime (SPY trend +
FRED macro + a Gemini-searched narrative), ~20 locally computed technical indicators, ~18 FMP
fundamentals, the Finnhub analyst rating + next-earnings date, the wiki briefing, retrieved research
evidence, and the AI's prior thesis. Genuinely new signal — **news/headline sentiment, insider
transactions, SEC filing catalysts, earnings-surprise / revisions history, systematic risk (beta)** —
is absent. Two fields, `Technicals.beta` and `Fundamentals.peForward`, are hard-coded `null` today.

**Non-goals.** Real-money data feeds; paid premium tiers (this round); replacing Gemini's own
web-grounded research; adding data that merely restates what the model already infers from price and
fundamentals.

## B. Design rules — how every integration plugs in

The codebase already has a clean, repeatable adapter pattern. Each integration follows it
mechanically (exemplars: `src/fundamentals/`, `src/macro/`):

1. **Typed port + fake + real adapter.** Define the port in `src/<domain>/types.ts`, a deterministic
   fake in `src/<domain>/fake/`, and the real adapter in `src/<domain>/<provider>/`. A
   `create<Domain>(env)` factory returns the fake unless the key/flag is present.
2. **Inject through the single `App` object** (`src/app.ts`), with a `CreateAppOptions` override so
   tests can inject a stub.
3. **Validate at the boundary** with Zod. **Degrade gracefully** — a failing source returns
   empty/null and never aborts `dailyRun`. One failing ticker or source must not discard the report.
4. **Cache per day** via the existing `cached(...)` wrapper pattern (`src/fundamentals/index.ts`) to
   stay inside free-tier rate limits.
5. **Consume** in `src/pipeline/llmReport.ts` alongside technicals/fundamentals, and **inject** as a
   compact new context block in `buildTickerStructurePrompt`. Keep the prompt budget disciplined — a
   label and a few numbers, never raw documents.
6. **Fill, don't bloat.** `beta` / `peForward` are existing fields to populate. Genuinely new numeric
   signals get a small new domain type (e.g. `AltSignals`) rather than swelling `Fundamentals`.
7. **Surface tool usage in the UI.** If an integration is ever exposed as an **LLM-callable tool**
   (rather than injected context), its calls must stream to the UI exactly like today's grounding
   search (`StreamSink` `{kind:"tool"}` events → `AnalysisStream.tsx`) and the grounded-query tools
   (cited tools → `PortfolioQuery.tsx`). Context-injected data instead shows provenance through the
   existing source citations.
8. **Docs-as-done.** Every integration ships with its `README.md` **and** roadmap-doc updates in the
   same change. No silent feature drift — this rule applies to every big change, not just
   integrations.
9. **Setup block.** Each integration documents key acquisition (or "none"), the env var name, the
   free-tier limit, and any required header.

## C. Tiered integration menu (free-first)

### Tier 0 — Zero new provider (free, do first)

No new API key. The highest ROI per effort, because the data is already in hand or already paid for.

- **Local beta.** Compute beta from the SPY bars and ticker bars the pipeline *already* fetches
  (correlation × volatility ratio over ~1y of daily returns). Fills the known `Technicals.beta` null
  and gives the model systematic-risk context. Lives in `src/analysis/technicals.ts`.
- **Expand the existing Finnhub adapter.** The `FINNHUB_API_KEY` is already held but only two
  endpoints are used (`analystRating`, `nextEarningsDate`). The free tier also covers:
  - **Insider transactions** — net insider buy/sell over a recent window (management conviction).
  - **Earnings-surprise history** — last ~4 quarters actual vs estimate (execution track record).
  - **Recommendation trend** — the *direction* of analyst revisions over time, not just the latest
    rating.
  - **Company news + sentiment** — recent headline flow and tone.
  - **`peForward`** where derivable.

  **Setup.** None new. Reuses `FINNHUB_API_KEY` (free tier, 60 req/min). Document the per-run rate
  budget so per-day caching stays within it.

### Tier 1 — Free, keyless new provider: SEC EDGAR

Already named in [`architecture-and-roadmap.md`](architecture-and-roadmap.md) §12 (Phase 6).

- **New `FilingsSource` port** (`src/filings/`). Signals: recent **8-K catalysts**, latest 10-K/10-Q
  **XBRL facts** (the `companyfacts` API), **Form 4** insider filings, and **13F**
  institutional-ownership change.
- Can also feed the knowledge graph (`source:` nodes) for provenance, so a filing-derived claim is
  traceable.

**Setup.** **No API key.** SEC requires a descriptive `User-Agent` header identifying the app and a
contact (e.g. `portfolio-tool you@email.com`); add it as `SEC_USER_AGENT`. Fair-access ceiling is
~10 req/s — cache aggressively per day. Endpoints are under `https://data.sec.gov/`.

### Tier 2 — Free news & sentiment: Tiingo News

- **New `NewsSource` port** (`src/news/`) → recent headline count, a sentiment score, and the top
  catalysts per ticker. Orthogonal signal that is not currently injected anywhere in the prompt.

**Setup.** Free account at tiingo.com → token in `TIINGO_API_KEY`. Free tier is **1,000 requests/day
and 50 symbols/hour** — cache per day and batch. (Alpha Vantage's news-sentiment endpoint is a
fallback, but its 25 req/day free cap is too tight for a daily multi-ticker run.)

## D. Sequencing & where each lands

Build order: **Tier 0 → Tier 1 → Tier 2**, each as its own spec → plan → build cycle. This document
is the menu; it does not implement anything.

| Integration | Tier | New / changed files | Env var | Free-tier limit | Prompt cost |
|---|---|---|---|---|---|
| Local beta | 0 | `src/analysis/technicals.ts` | — | n/a (local) | fills existing field |
| Finnhub expansion | 0 | `src/fundamentals/finnhub/`, domain type, prompt block | `FINNHUB_API_KEY` (held) | 60 req/min | 1 compact block |
| SEC EDGAR | 1 | `src/filings/{types,fake,edgar}`, `app.ts`, prompt block | `SEC_USER_AGENT` (no key) | ~10 req/s | 1 compact block |
| Tiingo news | 2 | `src/news/{types,fake,tiingo}`, `app.ts`, prompt block | `TIINGO_API_KEY` | 1,000/day, 50 sym/hr | 1 compact block |

Each new adapter also adds: a fake adapter, a `create<Domain>(env)` factory, a `CreateAppOptions`
override, a per-day cache, a smoke script (`scripts/<provider>-smoke.ts`), and README + roadmap
updates.

## E. Explicitly out of scope — paid sources (NOT pursued)

Deliberately **not** built because they cost money: short interest / borrow fees (Fintel), options
flow + dealer positioning (Unusual Whales), earnings-call transcripts (Quartr), and premium
aggregators (EODHD, Polygon, Benzinga). If ever revisited, the natural home is **MCP tools on the
grounded-query model** — interactive, on-demand, with tool calls shown in the UI per design rule
B.7 — rather than the deterministic daily forecast. Recorded here so the decision is explicit, not so
it becomes a backlog.

## F. Risks

- **Free-tier rate limits.** Mitigated by the per-day `cached(...)` wrapper and batching.
- **Data-quality variance.** Treat every source as fallible; surface gaps rather than silently
  guessing. A null signal is fine — a wrong one is not.
- **Prompt-budget creep.** Each integration adds at most one compact block; cap each block and prefer
  numbers over prose. Re-check the structure-prompt size after every addition.
- **Lookahead / survivorship discipline.** Carried over from
  [`architecture-and-roadmap.md`](architecture-and-roadmap.md) §16 — news, filings, and insider data
  must be timestamped and never leak post-forecast information into resolution.
