# Portfolio Intelligence Platform

A locally run research dashboard that mirrors your stock holdings and runs a daily analysis
pipeline, benchmarked A/B against a self-contained **AI paper portfolio** and SPY. The AI manages its
own $100k paper book; your manually entered holdings stay **advisory-only and can never place
orders**. **Paper trading only — model outputs are not investment advice.**

Two tracked documents define the system:

- [`docs/architecture-and-roadmap.md`](docs/architecture-and-roadmap.md) — the canonical architecture,
  data policies, and ordered build roadmap.
- [`docs/integrations-roadmap.md`](docs/integrations-roadmap.md) — the free-first plan for new external
  data sources that would sharpen the prediction LLM.

## Current status

Phases **0–5** are implemented. The platform is well past the original market-analysis app — it now
persists, resolves, and learns from its own forecasts, trades a guarded paper book, and answers
grounded questions about its own record:

- **Daily pipeline** — price portfolios → resolve due forecasts → compile wiki briefing → gather
  market context → build the universe → retrieve research evidence → analyze → persist journal +
  forecasts → propose & execute guarded paper trades → persist snapshots. One failing ticker or
  source never discards the report.
- **Typed journal (3A)** — every recommendation is persisted immutably with its full context and
  citations; complete actionable `BUY/ADD/TRIM/SELL` plans also become scored forecasts. The
  dashboard journal is day-grouped (click a day → that day's calls → thesis, forecast contract,
  resolved outcome, linked trades).
- **Guarded AI paper trading (3B)** — the AI autonomously manages a self-contained DB-backed $100k
  ledger. A **deterministic planner** turns the holder-neutral thesis (direction/conviction/
  target/stop) into orders — the LLM never sizes or gates. Every proposed/skipped/submitted/
  filled/failed decision is logged with a reason. Auto-execution defaults **ON** (paper-gated,
  toggleable).
- **Research knowledge base (3C)** — upload PDFs/Markdown/text, snapshot URLs, and write private
  notes; approved, scoped excerpts are retrieved (graph-aware) into the research stage as delimited
  **untrusted** evidence, with SSRF guards, sanitization, and quarantine.
- **Forecast resolution (3D)** — due forecasts are graded deterministically against historical
  daily high/low bars, with lookahead protection, ambiguous-touch handling, and versioned outcomes.
- **Performance wiki + calibration (4)** — deterministic cohort metrics (hit-rate, expectancy,
  stated-vs-realized conviction, Brier, vs-SPY) and evidence-gated prose lessons, compiled into a
  compact briefing injected into future analysis as trusted computed context.
- **Grounded NL query (5)** — "ask your portfolio anything": a Gemini tool-use loop over read-only
  data tools answers only from your own journal/forecasts/outcomes/wiki/trades/graph/research, and
  streams the answer plus the tools it used.
- **Mature risk controls (5)** — per-preset reward:risk floors, allowed horizons, and
  strategy-family eligibility govern the AI planner. The advisory book and the AI book carry
  **independent** risk presets.
- **Knowledge-graph substrate** — `kg_nodes` / `kg_edges` connect tickers, themes, sources, lessons,
  and strategies; powers graph-aware retrieval and lesson provenance.

Next: **Phase 6** (validation & polish) and the **data integrations** in
[`docs/integrations-roadmap.md`](docs/integrations-roadmap.md).

## Quickstart

The app runs fully offline against deterministic fake adapters — **no API keys required**:

```bash
bun install
cp .env.example .env          # defaults to MARKET_ADAPTER=fake
bun run db:migrate
bun run dev                   # backend :8787 + Vite :5173
```

Open <http://localhost:5173>, use **Manage** to add holdings or watchlist tickers, then select
**Run analysis**. Every external key is optional; absence degrades to a deterministic fake.

## External services

All keys are optional and live in `.env` only. Missing keys degrade gracefully to fakes.

| Service | Env key(s) | Purpose | Verify |
|---|---|---|---|
| Alpaca (paper) | `MARKET_ADAPTER=alpaca`, `ALPACA_KEY_ID`, `ALPACA_SECRET`, `ALPACA_PAPER=true` | Market data + the AI book's **paper** brokerage | `bun run alpaca:smoke` |
| Gemini | `GEMINI_API_KEY` (+ `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`) | LLM analysis + grounded query; falls back to deterministic reports | `bun run gemini:smoke` |
| FMP | `FMP_API_KEY` | Fundamentals and screener candidates | `bun run fmp:smoke` |
| FRED | `FRED_API_KEY` | Rates, curve, CPI, unemployment, VIX macro context | `bun run fred:smoke` |
| Finnhub | `FINNHUB_API_KEY` | Analyst consensus and upcoming earnings | `bun run finnhub:smoke` |

```text
MARKET_ADAPTER=alpaca
ALPACA_KEY_ID=your_key_id
ALPACA_SECRET=your_secret
ALPACA_PAPER=true
GEMINI_API_KEY=your_gemini_key
FMP_API_KEY=your_fmp_key
FRED_API_KEY=your_fred_key
FINNHUB_API_KEY=your_finnhub_key
```

> **Paper-only guard.** The app refuses to start with `MARKET_ADAPTER=alpaca` unless
> `ALPACA_PAPER=true`. There is no live-money adapter or real-portfolio execution path. The
> manually entered user portfolio is advisory-only and can never place orders.

## How the daily run works

`dailyRun` is the single composable operation behind both the manual trigger and the local
scheduler:

```text
1. Sync and price portfolios (user + AI paper)
2. Resolve due forecasts against historical high/low bars
3. Compile the active wiki briefing
4. Gather market context (SPY trend + FRED macro + searched narrative)
5. Build held + watchlist + scan + AI-thesis universe
6. Retrieve scoped research-library evidence (graph-aware)
7. Analyze tickers (two-stage Gemini: research → structure)
8. Persist report + journal + scored forecasts
9. Propose and execute guarded AI paper trades (deterministic planner)
10. Persist trade decisions + snapshots → stream completion to the UI
```

## Dashboard

1. **Header** — risk selector, schedule, manual run, last-run status.
2. **Overview, equity curve, portfolios** — user, AI paper, and SPY (contribution-neutral returns).
3. **Daily recommendations** — position-aware cards; live analysis stream during a run.
4. **AI trading** — the AI's $100k paper book: auto-trading status and the trade log.
5. **Journal** — day-grouped calls → thesis, forecast contract, outcome, linked trades.
6. **Knowledge library + curated memory** — uploads, URLs, notes; scope, version, trust, quarantine.
7. **Performance wiki** — active briefing, evidence-gated lessons, calibration.
8. **Ask your portfolio** — grounded NL query with the answer drawn only from your own data.

**Transparency.** The live analysis stream and "Ask your portfolio" both surface the LLM's **tool
calls and cited sources** — every grounded answer shows what it used.

## Project layout

```text
src/
├── analysis/      technicals, market context, universe, opportunity scan
├── config/        env loading and paper-only validation
├── db/            SQLite connection, migrations, repositories
├── domain/        Zod schemas and shared API types
├── execution/     deterministic trade planner + self-contained AI ledger
├── fundamentals/  fake, FMP, and Finnhub-backed enrichment
├── knowledge/     research-library ingestion, sanitization, graph-aware retrieval
├── llm/           Gemini adapter, prompts, normalization, schemas, streaming
├── macro/         fake and FRED-backed macro snapshots
├── market/        fake and Alpaca MarketGateway adapters
├── pipeline/      dailyRun orchestration, journaling, live events
├── query/         grounded NL query — read-only tools + Gemini tool-use loop
├── resolution/    historical high/low provider + deterministic forecast grading
├── scheduler/     once-per-day automatic run trigger
├── server/        Hono HTTP API
└── wiki/          deterministic cohort metrics, lessons, calibration, briefing
web/               React + Vite + Tailwind + Recharts + TanStack Query
```

The frontend imports shared backend types through the `@shared` alias. Every external integration is
a typed port with a deterministic fake and a real adapter, injected through a single `App` object
(`src/app.ts`).

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Run backend and Vite together |
| `bun run server` | Run backend API only on `:8787` |
| `bun run db:migrate` | Create or upgrade the SQLite schema |
| `bun run alpaca:smoke` | Verify Alpaca paper credentials |
| `bun run gemini:smoke` | Verify Gemini API key |
| `bun run fmp:smoke` | Verify FMP API key |
| `bun run fred:smoke` | Verify FRED API key |
| `bun run finnhub:smoke` | Verify Finnhub API key |
| `bun test` | Run unit and integration tests |
| `bun run test:e2e` | Run Playwright browser tests |
| `bun run build:web` | Build the production frontend |

## Guardrails

- **Paper only.** No implicit real-money path; AI execution is hard-gated to confirmed Alpaca paper
  mode.
- **The user portfolio can never trade.** It is advisory-only, permanently.
- **Uploaded content is untrusted evidence.** It is injected only into the research stage inside a
  delimited block — never into sizing, gating, or execution.
- **Compile, don't re-derive.** The LLM reads the deterministic linted briefing and delimited
  evidence, never the raw journal or graph. The wiki never turns model prose into "learned" facts.
- **Resolve without lookahead.** Outcomes use only data available after the forecast timestamp;
  resolution logic is versioned and never silently rewritten.

## Documentation policy

Keep tracked architecture in [`docs/architecture-and-roadmap.md`](docs/architecture-and-roadmap.md)
and the integrations plan in [`docs/integrations-roadmap.md`](docs/integrations-roadmap.md). Every
big change updates the README and the relevant doc in the same change so features never drift out of
the docs. Keep private working notes, conversation exports, and temporary plans under `docs/local/`,
`docs/conversations/`, or `docs/plans/` — those directories are intentionally gitignored. Secrets
live in `.env` only.
