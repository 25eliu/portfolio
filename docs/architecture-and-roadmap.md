# Portfolio Intelligence Platform — Living Architecture and Build Roadmap

> **Scope and disclaimer.** This is a personal research and analysis tool. The user portfolio is
> advisory-only. Brokerage actions are restricted to an Alpaca **paper** account used by the AI
> shadow portfolio. Recommendations are model outputs, not investment advice. Treat backtests with
> suspicion because lookahead and survivorship bias can make weak strategies look strong.

## 1. Product direction

The platform mirrors manually entered real-world holdings, runs a daily market-analysis pipeline,
and compares the user's portfolio with an AI-driven paper portfolio and SPY. Each recommendation
already includes a structured forward prediction. The next major objective is to persist those
recommendations, add auditable paper-only execution, resolve forecast outcomes honestly, and compile
evidence-backed lessons into future analysis.

The long-term memory design follows a “compile, don't re-derive” knowledge-base pattern:

1. **Research library** — user-uploaded documents, URL snapshots, and notes retrieved as cited
   evidence during ticker research.
2. **Typed journal** — immutable recommendations, forecasts, trade decisions, outcomes, and evidence
   links for exact statistics and auditability.
3. **Performance wiki** — deterministic metrics plus versioned prose lessons compiled from resolved
   forecasts and injected into subsequent analysis prompts.

These are separate systems. Uploaded text is evidence, not instruction. Wiki prose summarizes
computed facts; it does not replace the database or grade the model from memory.

## 2. Current implementation

### Implemented

- Bun + TypeScript single-repo application with SQLite, migrations, Zod schemas, and Hono routes.
- React/Vite dashboard with Tailwind, Recharts, TanStack Query, streamed analysis status, holdings
  manager, watchlist manager, risk selector, scheduling dialog, recommendation cards, and portfolio
  comparison views.
- User portfolio mirror with manually entered holdings, optional cost basis, and cash.
- AI shadow portfolio pricing sourced from the selected market gateway's paper-account positions.
- Fake deterministic adapters for offline development and tests.
- Alpaca REST market-data and paper-brokerage adapter with a hard `ALPACA_PAPER=true` startup guard.
- Gemini analysis with schema validation and deterministic fake-report fallback.
- FMP fundamentals and screens, FRED macro data, and Finnhub analyst-consensus / earnings enrichment.
- Market context, technical calculations, watchlist + scan universe building, thematic discovery,
  position-aware verbs, structured predictions, live SSE events, run logs, and snapshot persistence.
- Once-per-day scheduling with an active local catch-up change: run on app open or wake, or by the
  selected local time, whichever comes first.
- Contribution-neutral return calculation work for portfolio summary performance.
- **Typed journal (3A):** every recommendation persisted as an immutable `journal_entries` row with
  its full context and citations; complete actionable `BUY/ADD/TRIM/SELL` plans additionally become
  `scored_forecasts`. Journal list/detail API and a **day-grouped** dashboard view: a collapsible list
  of days, each expanding to that day's calls. Same-day re-runs are deduped to the latest call per
  ticker (`listDay`), while every run's entry is retained for audit and the per-ticker history view.
- **Forecast resolution (3D):** deterministic grading of due forecasts against historical daily
  high/low bars (Alpaca `adjustment=all`, fake provider for tests), with lookahead protection,
  ambiguous-touch handling, terminal/SPY-excess/MFE/MAE/R, and versioned, immutable `forecast_outcomes`.
  Runs before analysis in `dailyRun`.
- **Research knowledge base (3C):** PDF/Markdown/text/URL/note ingestion with SSRF guards, HTML
  sanitization, content classification/quarantine, immutable hashed versions, and SQLite FTS5 chunks.
  Graph-aware retrieval injects approved, scoped excerpts into the LLM research stage as delimited
  untrusted evidence; usage is recorded in `recommendation_evidence`. Knowledge-library UI with
  trust/scope/version/quarantine display and private-note opt-in.
- **Performance wiki + calibration (Phase 4):** deterministic cohort metrics (hit-rate, expectancy,
  stated-vs-realized conviction, Brier, vs-SPY) from resolved outcomes; evidence-gated prose lessons
  (n≥5 provisional, n≥20 active) with linting; a compact, deduped table briefing injected into future
  analysis as trusted computed context. Wiki UI with briefing, lessons, and calibration.
- **Knowledge-graph substrate:** `kg_nodes` / `kg_edges` connect tickers, themes, sources, lessons,
  and strategies with stable slug ids and typed, bidirectionally-queryable edges; powers graph-aware
  retrieval and lesson provenance. Graph query API.
- **Guarded AI paper trading (Phase 3B):** the AI autonomously manages its own paper book. Its own
  positions join the analysis universe each run, and a **deterministic planner** turns the holder-neutral
  thesis (direction/conviction/target/stop) into BUY/ADD/TRIM/SELL orders — the LLM never sizes or
  gates. `execution_settings` (auto-execute toggle) and `trade_decisions` (auditable
  proposed/skipped/submitted/filled/failed log, linked to journal entry + scored forecast). Trades +
  auto-trading controls in the UI.
  - **Capital model:** the AI book is a **self-contained DB-backed ledger** seeded at a fixed
    `AI_STARTING_CASH` ($100k), independent of the user's portfolio and any live broker. It sizes against
    its own compounding equity; fills mutate its own holdings + cash (`execution/ledger.ts`). Always-on
    (no seed/toggle).
- **Grounded NL query (Phase 5):** "ask your portfolio anything" — a Gemini tool-use loop over 9
  read-only data tools (`src/query/`) answers from the journal / forecasts / outcomes / wiki / trades /
  graph / research only (never recall), streams the answer + cited tools over SSE, and logs every Q&A to
  `query_log`. API `POST /api/query` + `GET /api/query/:id/stream`; an "Ask your portfolio" UI panel.

### Execution posture

The AI portfolio is **actively traded** (paper only). `dailyRun` submits guarded orders through the
paper gateway. Per the owner's directive, **auto-execution defaults ON** (a deliberate change from the
original §7 "default disabled" stance) — acceptable because execution is hard-gated to confirmed paper
mode and capped to a baseline matched to the user's portfolio. It is toggleable at any time. The
manually entered user portfolio remains advisory-only and can never place orders.

### Not implemented yet

- Mature risk controls — per-preset reward:risk thresholds, allowed horizons, strategy eligibility, and
  separate advisory/AI risk profiles (remaining half of Phase 5; v1 uses a fixed reward:risk floor +
  the existing presets).
- QuantConnect strategy-family validation gate, richer performance analytics, and run-failure alerts
  (Phase 6).
- Embeddings / semantic retrieval (deferred until lexical + graph-aware FTS proves insufficient) and
  company-name alias expansion (e.g. "Apple" ↔ AAPL) for retrieval.
- A deterministic directive/action-cue layer over wiki lessons (kept descriptive-only for now).

### Known cleanup

- Add focused tests for contribution-neutral return calculations.
- Keep the Playwright critical path aligned with implemented UI behavior.
- Wire real beta enrichment into technical calculations; it is currently passed as `null`.
- Consider frontend code-splitting; the production bundle triggers Vite's large-chunk warning (the new
  journal/knowledge/wiki panels add to it).

## 3. Plan evolution

The original architecture was a useful target, but the implementation intentionally took a simpler
path. Continue extending the codebase that exists; do not rewrite it merely to match the initial
scaffold proposal.

| Original draft | Current implementation | Direction |
|---|---|---|
| pnpm workspace monorepo | Bun single repo | Keep the single repo until package boundaries create real pressure. |
| Effect orchestration and `HttpApi` | Plain async pipeline, Hono API, Zod schemas | Extend existing patterns; add typed step errors incrementally where valuable. |
| Anthropic structured output | Gemini adapter with Zod validation | Keep the provider boundary; Gemini remains the default. |
| MCP wrappers for Alpaca, Maverick, EODHD, QuantConnect | Direct REST adapters for Alpaca, FMP, FRED, Finnhub; local technicals | Preserve adapter boundaries. Add providers only when a roadmap feature requires them. |
| Maverick technicals | Local technical calculations | Keep local calculations; enrich selectively rather than introducing a mandatory service. |
| EODHD fundamentals/news/resolution | FMP + Finnhub fundamentals and Alpaca market data | Evaluate Alpaca first for historical resolution; add another adapter only if coverage is insufficient. |
| Manual-only analysis trigger | Manual trigger plus local scheduler | Keep both triggers routed through the same guarded run path. |

## 4. Target daily pipeline

`dailyRun` remains the single composable operation for manual and scheduled triggers.

```mermaid
flowchart TD
    T[Manual run or local scheduler] --> A[1. Sync and price portfolios]
    A --> B[2. Resolve due forecasts]
    B --> C[3. Compile active wiki briefing]
    C --> D[4. Gather market context]
    D --> E[5. Build held + watchlist + scan universe]
    E --> F[6. Retrieve scoped research-library evidence]
    F --> G[7. Analyze tickers]
    G --> H[8. Persist report + journal forecasts]
    H --> I[9. Propose and execute guarded AI paper trades]
    I --> J[10. Persist trade decisions + snapshots]
    J --> K[Done: stream completion and refresh UI]
```

Current code implements pricing, context gathering, scanning, analysis, report persistence, snapshot
persistence, run logs, live progress events, and both triggers. The ordered additions are journal
persistence, guarded AI paper execution, research-library ingestion, forecast resolution, and wiki
compilation.

Every network-backed step should degrade gracefully where possible. One failing ticker must not
discard the daily report. Execution failures must be recorded and surfaced, never silently ignored.

## 5. Analysis and scoring policy

Recommendations, forecasts, executions, and portfolio returns answer different questions. Persist and
report them separately.

### Recommendation policy

- Journal every generated recommendation.
- Create a scored forecast only for complete actionable `BUY`, `ADD`, `TRIM`, and `SELL` plans.
- Store `HOLD`, `WATCH`, and `PASS` as visible but unscored decisions in v1.
- Treat `BUY` and `ADD` as bullish scored plans.
- Treat `TRIM` and `SELL` as bearish downside forecasts for scoring. AI execution only reduces or
  exits owned long positions unless shorting is explicitly introduced in a later phase.
- Define actionable-call `conviction` as the estimated probability that the target is reached before
  the stop within the stated horizon.

### Scored forecast record

Each scored forecast must capture:

```text
ScoredForecast {
  id, journalEntryId, ticker, side, strategyFamily, signals[],
  createdAt, asOfTimestamp, marketSession, quoteTimestamp, priceFeed,
  referencePrice, entry, target, stop, horizonTradingSessions, resolveAt,
  conviction, benchmarkSymbol, benchmarkReferencePrice,
  resolutionPolicyVersion, marketContextId, citedSourceIds[], retrievedChunkIds[]
}
```

### Resolution policy

- Resolve against historical daily high/low bars across the forecast interval, not only the final
  closing price.
- Account for splits, dividends, symbol changes, and other relevant corporate actions according to a
  versioned adjustment policy.
- If a daily bar shows both target and stop touched, record `ambiguous_touch`, exclude it from primary
  calibration and expectancy, and expose a conservative stop-first scenario separately.
- Store terminal return, SPY excess return, max favorable excursion, max adverse excursion, forecast
  R, resolved timestamp, and outcome.
- Keep advisory forecast R separate from actual AI-paper trade P&L.
- Version resolution logic. Never silently rewrite historical outcomes when a provider or policy
  changes.

## 5a. Knowledge-graph substrate (implemented)

The research library (§8) and performance wiki (§9) share one connective layer: `kg_nodes` and
`kg_edges`. Nodes are atomic canonical concepts with stable, human-readable slug ids
(`ticker:aapl`, `theme:ai-datacenter`, `source:<id>`, `lesson:all_time:overall`, `strategy_family:momentum`),
deduplicated by id. Edges are typed and deduplicated by `(src, rel, dst)` — `tagged_with`, `mentions`,
`cites`, `derived_from`, `supports`, `supersedes`, `belongs_to`, `in_cohort`, `related_to` — and are
queryable in both directions (`neighbors` / `backlinks`). This keeps the knowledge well-connected and
traversable. Concrete records (chunks, forecasts, outcomes) stay in their first-class tables; the graph
holds the canonical concepts and the relationships between everything, and is what retrieval and the
wiki briefing are compiled against. "Compile, don't re-derive" is preserved: the LLM never reads the
graph or journal raw — it reads the deterministic, linted briefing and the delimited untrusted evidence.

## 6. Typed journal and trade audit

Use first-class SQLite tables for common queries. The knowledge graph (§5a) sits alongside these for
relationship queries and provenance.

```text
journal_entries       every recommendation, scored or unscored
scored_forecasts      complete actionable plans and scoring policy
forecast_outcomes     resolution result and measured performance
trade_decisions       proposed, skipped, submitted, filled, failed
execution_settings    paper auto-execution enabled flag
recommendation_evidence exact chunks used by each recommendation
```

The journal must preserve the exact report, market context, citations, and retrieved research chunks
used to generate each recommendation. Recommendation cards should link to their journal records.

## 7. AI paper execution

AI paper execution is intentionally the first product milestone after journal persistence. The AI
portfolio should begin recording real A/B behavior before the full wiki compiler is built.

### Required behavior

> **Implemented (3B).** The behavior below is built; the one deviation is the default posture.

- Seed the AI book with a baseline **matched to the user's total equity** (auto-seeded on first run;
  `POST /api/execution/seed` re-seeds, optionally with an explicit amount). The paper account's extra
  cash beyond the baseline is never deployed.
- **AI paper auto-execution defaults ON** per the owner's directive (the original spec said disabled).
  Toggleable via `PUT /api/execution/settings`. Safe because execution is hard-gated to confirmed paper
  mode; when off, runs record proposals but submit nothing.
- A **deterministic planner** turns the holder-neutral thesis (direction/conviction/target/stop) into
  BUY/ADD/TRIM/SELL orders using the risk presets, baseline capital, current exposure, confidence, and a
  reward:risk floor. The LLM never sizes or selects.
- Apply duplicate-order, concurrent-run (the run is already serialized), max-position, max-position-count,
  available-cash, and baseline-exposure guards.
- Persist proposed, skipped, submitted, filled, and failed trade decisions with an auditable reason,
  linked to the journal entry + scored forecast.
- Submit orders only through a positively-confirmed paper gateway.
- Surface trade activity, skip reasons, and the auto-trading toggle in the dashboard.

### Permanent guardrails

- The manually entered user portfolio remains advisory-only and can never place orders.
- Reject AI execution unless Alpaca paper mode is positively confirmed.
- Never allow uploaded content, wiki prose, or LLM output to bypass deterministic sizing and safety
  checks.
- Include cash and transaction costs when reporting actual AI-paper performance.
- Keep hypothetical forecast performance visibly separate from executed paper-trade performance.

## 8. Research knowledge base

The research library lets the user upload documents, add URLs, and write notes that Gemini can
retrieve during ticker research. This is separate from the outcome-backed performance wiki.

### Source tables

```text
knowledge_sources        source metadata, trust class, scope, analysis opt-in, status
knowledge_versions       immutable upload or URL snapshots with content hash and timestamp
knowledge_chunks         extracted and sanitized text chunks
knowledge_chunks_fts     SQLite FTS5 index for active chunks
knowledge_tags           confirmed and suggested ticker/topic tags
knowledge_ingestion_runs parser status, warnings, quarantine reason
recommendation_evidence  exact retrieved chunks used by each recommendation
```

### Supported v1 inputs

- PDF uploads
- Markdown and plain-text uploads
- Pasted private notes
- Fetched `http` and `https` URLs

Store raw files under gitignored `data/knowledge/`. Store metadata, extracted text, hashes, chunks,
and provenance in SQLite. URL refreshes create immutable new versions instead of overwriting history.

### Scope and trust

Trust classes:

```text
public_url
public_upload
private_note
system_lesson
```

- Require the user to assign global or ticker tags. Model-suggested tags remain inactive until
  confirmed.
- Permit private notes, but default `use_in_analysis=false`. Each private note requires explicit
  opt-in before retrieval into ticker analysis.
- Display trust class, scope, snapshot timestamp, version, and quarantine status in the UI.

### Safe retrieval

- Use SQLite FTS5 lexical retrieval first. Defer embeddings until lexical retrieval proves
  insufficient.
- Retrieve only active, scoped, approved chunks. Default to the top `6` chunks and a maximum of
  `4,000` characters per ticker.
- **Retrieval is graph-aware (implemented):** gather sources from ticker scope, graph links
  (`tagged_with` / `mentions` edges via §5a), and FTS expanded with graph-linked theme/strategy labels
  plus the candidate's screen — so evidence that the bare-ticker match misses is still found.
- Include title, version, timestamp, and trust class with every excerpt. The chunk ID is persisted on
  `recommendation_evidence` for provenance but is **not** rendered into the prompt (the model can't act
  on a UUID — token waste).
- Inject excerpts only into Gemini's research stage inside a delimited untrusted-evidence section.
  Do not pass raw documents to structuring or execution stages.
- Persist exact retrieved chunk IDs on each recommendation for reproducibility.
- Sanitize HTML, remove scripts/styles/metadata, normalize text, reject unsupported MIME types, cap
  file and response sizes, and quarantine suspicious content.
- Block SSRF: reject non-HTTP schemes, credentials in URLs, localhost, private/link-local IPs, and
  redirects into blocked ranges.
- Add a no-tools document-classification / summarization guardrail before broad external connectors.
  Pattern filters alone are insufficient protection against indirect prompt injection.

## 9. Performance wiki and feedback loop

The performance wiki is compiled from deterministic journal metrics. It must never turn user-uploaded
claims or model-written prose directly into “learned” facts.

### Wiki tables

```text
wiki_metrics    deterministic cohort statistics with source forecast IDs
wiki_lessons    versioned evidence-backed prose lessons
briefings       dated compiled prompt context and included metric/lesson versions
```

### Lesson lifecycle

```text
draft → provisional → active → superseded | expired | rejected
```

Evidence-gated auto-publication defaults:

- `draft` at any sample size.
- `provisional` at `n >= 5` resolved forecasts.
- `active` at `n >= 20`, with a bounded cohort, reproducible metrics, and non-stale evidence.
- Downgrade or expire lessons when evidence ages beyond the configured freshness window or later data
  contradicts them.

### Compilation rules

- Compute facts before generating prose.
- Include sample size, date window, source forecast IDs, freshness deadline, and supersession history
  with every lesson.
- Generate prose only from computed metrics. The LLM may summarize evidence, but it may not invent
  statistics, mark its own prediction correct, or convert private notes into performance lessons.
- Compile sections for market regime, calibrated confidence, strategy-family expectancy,
  signal/horizon cohorts, recurring errors, and stale or contradictory lessons.
- Default to rolling `90` trading-day findings plus all-time context.
- Keep the prompt briefing compact and versioned.
- Lint lessons: reject missing evidence, missing sample sizes, stale findings, contradictory active
  lessons, unfair wording, and briefing-budget overflow.

Calibration should use a defined binary event: target reached before stop within the forecast
horizon. Track Brier-style score, reliability by confidence bucket, expectancy, and coverage.

**Briefing format (implemented).** Lessons keep prose for the human-facing wiki UI, but the *injected*
briefing is a compact table for token efficiency and low redundancy: one header naming the metrics
once, then one dense row per decision-relevant cohort — `cohort | n | hit% | expR | conv% | vsSPY% |
Brier`. The `conv%` column (mean stated conviction) sits beside `hit%` so the calibration gap is
visible at a glance. Confidence-bucket and horizon cohorts are dropped from the briefing (they restate
the calibration gap) but stay queryable via `/api/wiki/metrics` and the graph; the rolling-90d row for
a cohort is emitted only when it diverges materially from all-time. Lessons remain descriptive — no
imperative directive layer (deferred).

## 10. Planned APIs

### Journal and execution (implemented)

```text
GET    /api/journal          (?ticker= filters to one name; ?date=YYYY-MM-DD deduped to latest call/ticker)
GET    /api/journal/days     (day summaries — date + distinct-ticker count + scored count)
GET    /api/journal/:id      (includes scored forecast, outcome, and linked trade decisions)
GET    /api/trades
GET    /api/execution/settings
PUT    /api/execution/settings
POST   /api/execution/seed
```

### Research library

```text
GET    /api/knowledge/sources
GET    /api/knowledge/sources/:id
POST   /api/knowledge/sources/upload
POST   /api/knowledge/sources/url
POST   /api/knowledge/sources/note
PUT    /api/knowledge/sources/:id
POST   /api/knowledge/sources/:id/refresh
DELETE /api/knowledge/sources/:id
```

Deleting a knowledge source archives it. It does not destroy provenance required by historical
recommendations.

### Wiki and graph (implemented)

```text
GET    /api/wiki/briefing
GET    /api/wiki/lessons
GET    /api/wiki/metrics
GET    /api/graph/nodes
GET    /api/graph/node/:id
```

## 11. Dashboard direction

Current single-dashboard structure (as built):

1. **Header** — risk selector, schedule, manual run button, last-run status.
2. **Overview, equity curve, and portfolios** — user, AI paper, and SPY performance (contribution-neutral
   returns) with holdings and allocation.
3. **Daily recommendations** — position-aware cards (live analysis stream during a run), each linking to
   its journal record.
4. **AI trading** — the AI's own $100k paper book: auto-trading status and the trade log (action, qty,
   status, skip reason), linked to the journal.
5. **Journal** — day-grouped: a collapsible list of days, each expanding to that day's calls; a call
   expands to its thesis/prediction, scored-forecast contract, resolved outcome, and linked trades.
6. **Knowledge library + curated memory** — uploads, URLs, notes, self-curated facts; source scope,
   versions, trust labels, quarantine status, and private-note analysis opt-in.
7. **Performance wiki** — active briefing, evidence-gated lessons, and calibration (hit-rate vs stated
   conviction, expectancy, Brier).
8. **Ask your portfolio** — grounded NL query: ask a question, get a streamed answer drawn only from
   your own data, with the tools it used shown.

## 12. Ordered build roadmap

> **Status (current):** the Active slice and Phases **3A, 3B, 3C, 3D, and 4** are **implemented** on a
> shared knowledge-graph substrate (§5a), plus **Phase 5's grounded NL query**. Remaining: **Phase 5's
> mature risk controls** and **Phase 6** (validation and polish).

### Active slice — scheduler and performance correctness ✅ done

- Finish scheduler catch-up semantics and schedule-dialog copy.
- Add unit tests for contribution-neutral returns.
- Verify summaries do not treat deposits or newly added positions as gains.
- Keep Playwright coverage aligned with the current no-seeding UI.

### Phase 3A — journal foundation ✅ done

- Add migrations, Zod types, repositories, and tests for journal entries and scored forecasts.
- Persist every recommendation after each report.
- Create scored forecasts only for complete actionable `BUY`, `ADD`, `TRIM`, and `SELL` plans.
- Add journal list/detail endpoints and initial open/unscored journal UI.

### Phase 3B — guarded AI paper trading ✅ done

- AI paper-account seeding (baseline matched to the user's equity; auto-seeded on first run).
- Execution settings; auto-execution defaults **ON** per owner directive (paper-gated; toggleable).
- Proposed-order audit records (`trade_decisions`), deterministic eligibility/sizing, and safety guards.
- Submits eligible orders only through a confirmed paper gateway and displays trade activity.

### Phase 3C — research-library ingestion ✅ done (graph-aware retrieval)

- Add source versioning, hashes, trust classes, scope tags, ingestion status, and FTS5 indexing.
- Add PDF, Markdown, text, private-note, and URL-snapshot ingestion.
- Add SSRF controls, sanitization, quarantine handling, and immutable URL refreshes.
- Add the knowledge-library UI and private-note analysis opt-in.
- Retrieve approved scoped excerpts into Gemini ticker research and persist evidence links.

### Phase 3D — forecast resolution ✅ done

- Add a historical high/low provider contract and one concrete adapter.
- Add trading-calendar, pagination, adjustment-policy, and corporate-action handling.
- Resolve target, stop, expiry, partial, and ambiguous-touch outcomes deterministically.
- Track terminal return, SPY excess return, favorable/adverse excursion, and forecast R.
- Run resolution before new analysis in `dailyRun`.

### Phase 4 — performance wiki and calibration ✅ done

- Add deterministic cohort metrics, evidence-gated lesson lifecycle, freshness, and linting.
- Calculate Brier-style score, confidence reliability, expectancy, and recurring failure patterns.
- Persist compact dated briefings and inject active lessons into future analysis prompts.
- Add briefing, lesson evidence, and calibration views.
- Briefing is a compact deduped table with a stated-vs-realized conviction (calibration) column; lessons
  stay descriptive (no directive layer yet).

### Phase 5 — grounded query ✅ done · mature risk controls (remaining)

- ✅ **Grounded NL query** ("ask your portfolio anything"): `src/query/` exposes 9 read-only tools
  (portfolio_state, open forecasts, outcomes, cohort_metrics, lessons, journal_calls, trade_decisions,
  graph_neighbors, knowledge_search). A Gemini tool-use loop (`answer.ts`, grounding contract +
  `MAX_TOOL_ROUNDS` cap, injectable for tests) answers from those tools only — never recall — and
  streams the answer + cited tools over SSE (`POST /api/query` → `GET /api/query/:id/stream`). Every
  Q&A is logged to `query_log`. UI: an "Ask your portfolio" panel.
- ⏳ **Mature risk controls (remaining Phase 5):** expand risk presets with allowed horizons,
  reward:risk thresholds, and strategy eligibility; allow separate advisory vs AI-paper risk profiles.

### Phase 6 — validation and polish

- Add SEC EDGAR public-filing ingestion.
- Add a QuantConnect gate for genuinely new systematic strategy families.
- Add drawdown, Sharpe-like, alpha, and trade-expectancy analytics.
- Add run-failure alerts, richer retries/timeouts, and frontend code-splitting.

## 13. Acceptance criteria for the next implementation handoff

Phases 3A (journal), 3C (knowledge base), 3D (resolution), and 4 (wiki) are **complete** — every
generated recommendation is journaled with its context and citations; complete actionable calls create
scored forecasts while incomplete plans stay visible but unscored; due forecasts resolve
deterministically before each analysis; approved scoped research is retrieved (graph-aware) as
delimited untrusted evidence; and a compact, evidence-gated wiki briefing is injected into analysis.
The dashboard lists journal, knowledge, and wiki records without relying on LLM recall.

Phase 3B (guarded AI paper trading) is **functionally complete**: the deterministic planner emits
guarded BUY/ADD/TRIM/SELL orders; auto-execution defaults ON (owner directive, toggleable); every
eligible/skipped/submitted/filled/failed order has an auditable reason linked to its journal entry and
scored forecast; and the user portfolio remains impossible to trade.

The mid-migration refactors (isolated $100k AI ledger, self-curated facts, cost-basis/day-P&L) have
**landed and are green** (`tsc` clean, full `bun test` passing), and **Phase 5's grounded NL query is
built** (the `src/query/` module + `/api/query` + "Ask your portfolio" panel; answers come only from
read-only tools, logged to `query_log`).

**The next coding agent should build the remaining half of Phase 5 — mature risk controls:** per-preset
reward:risk thresholds, allowed horizons, and strategy-family eligibility wired into the execution
planner; and (if wanted) separate advisory vs AI-paper risk profiles. Then Phase 6 (validation/polish:
SEC EDGAR ingestion, QuantConnect gate, drawdown/Sharpe/alpha analytics, run-failure alerts, frontend
code-splitting). All phases must use the policies in this document.

## 14. Repository documentation policy

- Keep this file as the canonical, tracked product architecture and ordered roadmap.
- Update it when implemented behavior or the intended next milestone changes.
- Keep private working notes, conversation exports, and temporary plans under `docs/local/`,
  `docs/conversations/`, or `docs/plans/`. Those paths are intentionally gitignored.
- Keep secrets in `.env` only. Never paste API keys into tracked documents or local conversation
  exports intended for sharing.

## 15. Reference standards

- Alpaca historical bars document adjustment modes, feeds, pagination, and `asof`:
  <https://docs.alpaca.markets/reference/stockbars>
- Alpaca explains IEX versus SIP historical-data coverage:
  <https://docs.alpaca.markets/us/docs/historical-stock-data-1>
- Alpaca documents corporate-action types and delayed availability:
  <https://docs.alpaca.markets/us/reference/corporateactions-1>
- CFA Institute describes GIPS fair-representation, disclosure, return-calculation, cash, and
  transaction-cost principles:
  <https://rpc.cfainstitute.org/gips-standards>
- SEC guidance describes fair and balanced presentation of performance and risks if results are ever
  shared beyond personal use:
  <https://www.sec.gov/investment/investment-adviser-marketing>
- SEC EDGAR APIs provide public filing metadata and XBRL facts without API keys:
  <https://www.sec.gov/search-filings/edgar-application-programming-interfaces>
- OWASP documents indirect prompt injection and RAG-poisoning defenses:
  <https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html>
- NIST defines retrieval-augmented generation as a model paired with a separate knowledge base:
  <https://csrc.nist.gov/glossary/term/retrieval_augmented_generation>

## 16. Guardrails

- Paper only. Never add an implicit real-money path.
- Resolve using data available after the forecast timestamp; avoid lookahead leakage.
- Prefer expectancy and calibration over headline hit rate.
- Keep uploaded content isolated as untrusted evidence.
- Keep the compiled briefing short, versioned, evidence-backed, and linted.
- Treat external providers as fallible and make failures visible.
- Preserve adapter boundaries so data sources can evolve without rewriting the pipeline.
