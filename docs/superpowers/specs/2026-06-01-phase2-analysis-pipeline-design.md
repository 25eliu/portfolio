# Phase 2 — Real Analysis Pipeline (Gemini 3.1 Pro + Alpaca + FMP)

## Context

Phase 0+1 shipped the foundations and the dual-portfolio mirror, with `dailyRun` emitting a
deterministic **fake** report as a placeholder for real analysis. Phase 2 replaces that placeholder
with genuine, industry-standard equity analysis so the dashboard becomes a real stock-picking and
advisory tool (paper-only, not investment advice).

This phase covers the roadmap's "Analysis pipeline (no learning yet)": gather market context +
per-ticker technicals **and fundamentals**, run an LLM analysis conditioned on that data, and
produce the structured daily report. **Manual trigger only. No trade execution** (that stays Phase
3). No prediction journal / resolution / learning loop (Phase 3–4).

### Locked decisions
- **LLM:** `gemini-3.1-pro-preview` (env-configurable model + thinking level). Gemini 3 supports
  combining **Google Search grounding** with **structured/function-tool output in one request** —
  verified by a spike before the pipeline is built.
- **Universe:** held holdings ∪ watchlist ∪ opportunity scan (Alpaca movers + FMP fundamental
  screens), capped + configurable.
- **Catalysts/news:** Gemini Google Search grounding (with citations).
- **Fundamentals:** **Financial Modeling Prep (FMP) free tier** for precise structured numbers
  (valuation, profitability, growth, health, estimates, price targets, earnings dates, screener).
- **Boundary:** recommendations + light market context only; AI portfolio still mirrors/prices, no
  execution.

### Data source split
| Source | Provides |
|---|---|
| **Alpaca** (have) | Real-time/delayed quotes, daily bars (→ technicals), most-actives & movers |
| **FMP free** (new key) | Company profile, TTM ratios, key metrics, growth, analyst estimates + price targets, ratings, earnings calendar, fundamental stock screener |
| **Gemini 3.1 Pro** (have) | Per-ticker analysis + market-context macro, Google Search grounding for news/catalysts with citations |

## Industry-standard analysis attributes

The analysis gathers and feeds the model the following. Every field is nullable and degrades
gracefully when a source/endpoint is unavailable (FMP free omits some premium fields).

**Technicals (from Alpaca bars, computed locally):** SMA & EMA 20/50/200 (+ price-vs-MA flags,
golden/death cross), RSI(14), MACD(12/26/9 line/signal/hist), Stochastic %K/%D, ATR(14), Bollinger
Bands(20,2) + %B, 52-week high/low + % from each, average volume (20d), relative volume, OBV,
VWAP, beta, recent swing support/resistance.

**Valuation (FMP):** market cap, P/E (trailing + forward), P/S, P/B, PEG, EV/EBITDA, FCF yield,
dividend yield.

**Profitability (FMP):** gross / operating / net margin, ROE, ROA, ROIC.

**Growth (FMP):** revenue growth (YoY, QoQ), EPS growth (YoY), forward revenue/EPS estimates.

**Financial health (FMP):** debt/equity, current ratio, quick ratio, free cash flow, interest
coverage.

**Estimates & sentiment (FMP + grounding):** analyst consensus rating, price targets (mean/high/
low + implied upside), # of analysts, recent EPS surprises, **next earnings date**, short interest /
days-to-cover, float.

**Catalyst/news (Gemini grounding):** recent headlines, earnings/guidance, upgrades/downgrades,
product/macro events — summarized with sentiment and **source citations**.

## Architecture — new modules

```
src/
├── fundamentals/        # FMP client (interface + fmp/ + fake/ adapters), Zod-validated responses
├── analysis/
│   ├── technicals.ts    # pure indicator math from bars (RSI, MACD, SMA/EMA, ATR, BBands, ...)
│   ├── marketContext.ts # SPY trend from bars + grounded macro summary → MarketContext
│   ├── universe.ts       # build held ∪ watchlist ∪ scan; dedupe + cap
│   └── opportunityScan.ts# Alpaca movers + FMP screener → candidate symbols by screen type
├── llm/
│   ├── gemini.ts        # @google/genai wrapper: grounded + function-tool call, citations
│   ├── schema.ts        # Recommendation Zod ↔ Gemini function declaration
│   ├── prompts.ts       # per-ticker + market-context prompt builders
│   └── analyze.ts       # Analyzer interface (real Gemini + mock for tests)
```

Each external dependency sits behind an interface with a **fake/deterministic adapter** (mirrors the
existing `MarketGateway` pattern) so the whole pipeline runs offline in tests with zero keys.

### Market data extension
- **Fix `getBars`** to send a `start` date (lookback ≈ 300 calendar days) so it returns real
  history for indicator math (currently returns 1 bar). Add `getBars(symbol, {lookbackDays})`.
- **Add movers:** `getMostActives(limit)` / `getMovers()` via Alpaca screener endpoints
  (`/v1beta1/screener/stocks/...`). Fake adapter returns a deterministic candidate set.

### Fundamentals client (`src/fundamentals/`)
- Interface `Fundamentals` with `getProfile`, `getRatiosTTM`, `getKeyMetricsTTM`, `getGrowth`,
  `getEstimates`, `getPriceTarget`, `getRating`, `getEarningsDate`, `screen(criteria)`.
- `fmp/` adapter → FMP v3 endpoints (`/profile`, `/ratios-ttm`, `/key-metrics-ttm`,
  `/financial-growth`, `/analyst-estimates`, `/price-target-consensus`, `/rating`,
  `/earning_calendar`, `/stock-screener`). Validate every response with Zod; missing/premium
  fields → null.
- `fake/` adapter → deterministic fundamentals for tests.
- **Daily cache** keyed by (symbol, date) in a `fundamentals_cache` table so a run doesn't refetch
  and we stay under the ~250 calls/day free limit.

### LLM layer (`src/llm/`)
- One call per ticker against `gemini-3.1-pro-preview` with **two tools enabled together**:
  `googleSearch` (built-in grounding) + a `submit_recommendation` function declaration whose
  parameters mirror the `Recommendation` schema. The model researches, then emits the structured
  recommendation as function args. Extract args + `groundingMetadata` citations → `sources`.
- Re-validate args with the `Recommendation` Zod schema (defense in depth); on validation/JSON
  failure, retry once, then skip that ticker (logged in the run), never crash the run.
- `thinkingLevel` and `model` from config. Bounded concurrency (`LLM_CONCURRENCY`).
- **Spike-first:** `bun run gemini:smoke` proves grounding+function-tool+citations on
  `gemini-3.1-pro-preview` before the pipeline is wired. Fallback if the combined call misbehaves:
  two-stage (grounded reasoning text → schema-coercion call with no tools).

## Domain model additions

Extend `src/domain/` (all new fields nullable; existing `Recommendation` stays backward-compatible):
- `Technicals` — expand from the current 4 fields to the full set above.
- `Fundamentals` — valuation / profitability / growth / health / estimates groups.
- `MarketContext` — `{ date, spyTrend, spyPctFromSMA200, breadthNote, macroSummary, sources[] }`.
- `Recommendation` — add `fundamentals`, richer `technicals`, `sources: {title,url}[]`,
  `priceTargetUpside`, and keep `catalyst` (now grounded).
- `DailyReport` — add `marketContext` and `source` stays `"llm" | "fake"`.
- `WatchlistItem` — `{ id, symbol, note? }` + table + repo + routes.
- `ScanCandidate` — `{ symbol, screen: "momentum"|"mean_reversion"|"value"|"quality_growth"|"catalyst", reason }`.

## Opportunity scan (industry-standard screens)

`opportunityScan.ts` produces candidates from:
- **Momentum/breakout** — Alpaca top gainers + relative-volume spikes; FMP screen: price > SMA200,
  near 52-wk high.
- **Mean-reversion** — RSI oversold / below lower Bollinger near support (computed on candidate bars).
- **Value** — FMP screen: low PEG, high FCF yield, reasonable debt.
- **Quality-growth** — FMP screen: high ROE + positive revenue growth.
- **Catalyst** — most-actives + unusual volume + near-term earnings (FMP earnings calendar).

Candidates are deduped, capped (`MAX_SCAN_CANDIDATES`), and each carries its screen + reason for the
prompt and the UI.

## Pipeline integration

`dailyRun` step 3 swaps `generateFakeReport` → `generateLlmReport(app, ctx)`:
1. Build `MarketContext` (SPY trend from bars + one grounded macro call).
2. Build universe: held ∪ watchlist ∪ scan candidates (deduped, capped).
3. Per ticker (bounded concurrency): bars → technicals; FMP → fundamentals (cached); Gemini grounded
   analysis → validated `Recommendation` (+ sources).
4. Assemble `DailyReport` (source `"llm"`), persist with `marketContext`.

**Resilience:** per-ticker timeout + single retry; a ticker that fails is skipped and logged, never
fatal. **If `GEMINI_API_KEY` is absent → fall back to the existing fake generator** so tests/offline
still produce a report. Wrap the run in the existing run-log try/catch.

## Config & secrets

Add to env schema (paper-only guard unchanged): `GEMINI_API_KEY`, `GEMINI_MODEL`
(default `gemini-3.1-pro-preview`), `GEMINI_THINKING_LEVEL` (default `medium`), `FMP_API_KEY`,
`LLM_CONCURRENCY` (default 4), `MAX_SCAN_CANDIDATES` (default 8). Keys in `.env` only, never
committed. `.env.example` + README updated with FMP + Gemini signup steps. New smoke scripts:
`bun run gemini:smoke`, `bun run fmp:smoke`.

## Rate limits, caching, cost

- **FMP free (~250/day):** daily `fundamentals_cache` keeps a run to one fetch per symbol per day.
- **Alpaca:** generous; bars/movers cached within a run.
- **Gemini grounding:** free allowance then billed; manual trigger + `MAX_SCAN_CANDIDATES` bound the
  universe. `gemini-3.1-pro-preview` ≈ $2/$12 per 1M tokens (≤200k). A ~15–25 ticker run is roughly
  a few cents to ~$0.25 depending on thinking level. Surface the universe size before/after a run.

## UI additions (follow the existing design system)

Extend the new `ui/` components + tokens (Card, Badge, Button, SegmentedControl, framer-motion,
sonner, lucide), not plain Tailwind:
- **Market-context banner** above recommendations: SPY trend, macro summary, regime tag.
- **Richer `RecommendationCard`:** key fundamentals (P/E, growth, margin, price-target upside),
  catalyst summary + sentiment, and **source citation links**; a compact technicals strip.
- **Watchlist management** in the ticker-manager modal (a second section/tab, reusing its pattern).
- **"Analyzing…" progress state** on Run (runs now take longer): show per-ticker progress / count
  via run status; keep the sonner toast on completion.
- Optional: an expandable "full metrics" drawer on a card for the complete attribute set.

## Testing

- **Unit:** technicals on known fixtures (verify RSI/MACD/SMA/ATR/BBands against reference values);
  universe builder + dedup/cap; opportunity-scan screen logic; Zod↔Gemini schema; prompt builders;
  FMP + Alpaca response parsing (fixtures).
- **Pipeline/integration:** `generateLlmReport` with an **injected mock Analyzer + fake
  Fundamentals + fake market gateway** → deterministic, offline, asserts schema-valid report,
  resilience (one ticker throws → skipped), and fake-fallback when no key. Watchlist routes.
- **Smoke (manual, real keys):** `gemini:smoke` (grounding + structured output + citations) and
  `fmp:smoke` (fundamentals fetch).
- **E2E:** keep green via fake fallback (no keys in CI) or a mock; add a watchlist add/remove flow.
- TDD throughout; keep `bun test` scoped to `src/`.

## Risks & guardrails

- **New-model uncertainty:** `gemini-3.1-pro-preview` post-dates training. Mitigation: **spike
  first** (`gemini:smoke`) to confirm the grounding+function-tool contract before building on it;
  two-stage fallback documented.
- **FMP free limits / premium fields:** some endpoints (price targets, estimates) may be premium —
  design for nullable fields + graceful degradation; cache daily.
- **LLM number hallucination:** exact figures come from FMP (structured), not the model; the model
  synthesizes/qualifies. Grounding citations make catalysts auditable.
- **Cost creep:** universe cap + manual trigger + surfaced run size. No auto-scheduling this phase.
- **Not advice / paper-only:** unchanged. The AI portfolio does not trade in Phase 2.

## Out of scope (later phases)

Trade execution on recommendations (Phase 3) · prediction journal + resolution + outcomes/error
reasons (Phase 3) · briefing compiler / calibration / Brier (Phase 4) · risk profile actually
parameterizing sizing/eligibility + cron scheduler + NL query (Phase 5) · QuantConnect backtest gate
(Phase 6).

## Suggested build order

1. `gemini:smoke` spike — confirm grounding + function-tool + citations on `gemini-3.1-pro-preview`.
2. Config + deps (`@google/genai`) + `GEMINI_*` / `FMP_*` env + `fmp:smoke`.
3. Market data: `getBars` history fix + movers (+ fake parity, tests).
4. `analysis/technicals.ts` full indicator suite (+ fixture tests).
5. `fundamentals/` FMP client + fake adapter + daily cache (+ tests).
6. `analysis/opportunityScan.ts` + `universe.ts` (+ tests).
7. `analysis/marketContext.ts` (+ grounded macro, tested with mock).
8. `llm/` prompts + schema + analyze (real + mock).
9. Swap pipeline step → `generateLlmReport` with fake fallback + resilience (+ tests).
10. Domain additions threaded through; UI: market-context banner, richer card, watchlist, analyzing
    state.
11. Verify end-to-end live (real Gemini + FMP + Alpaca); keep `bun test` + E2E green.
