# Portfolio Intelligence Platform

A locally run research dashboard that mirrors your stock holdings and runs a daily analysis
pipeline, benchmarked A/B against an AI-driven **paper** portfolio. **Paper trading only — not
investment advice.**

The working architecture and ordered build roadmap live in
[`docs/architecture-and-roadmap.md`](docs/architecture-and-roadmap.md). That document updates the
original plan to match the codebase as it exists today.

## Current status

The repository substantially implements **Phases 0–2**:

- local SQLite persistence, typed domain schemas, migrations, and a Hono API
- editable user holdings, cash, watchlist, risk preset, and automatic-run schedule
- side-by-side user and AI-paper portfolio pricing with You-vs-AI-vs-SPY history
- contribution-neutral portfolio returns and a daily scheduler catch-up path
- Gemini analysis with a deterministic offline fallback
- Alpaca market data and paper brokerage, FMP fundamentals, FRED macro context, and Finnhub
  analyst-consensus / earnings enrichment
- opportunity scanning, structured position-aware recommendations, forward predictions, and live
  streamed analysis progress

The main unbuilt product slice is the learning loop: prediction persistence, resolution,
calibration, compiled briefing, guarded AI-paper execution, and grounded journal queries.

> **AI portfolio status:** the app currently displays positions already present in the connected
> Alpaca paper account, but it does not place orders yet. Journal persistence, explicit AI-paper
> seeding, and guarded auto-execution are the next trading milestones. The user portfolio remains
> advisory-only permanently.

## Quickstart

The app runs fully offline against deterministic fake adapters:

```bash
bun install
cp .env.example .env          # defaults to MARKET_ADAPTER=fake
bun run db:migrate
bun run dev                   # backend :8787 + Vite :5173
```

Open <http://localhost:5173>, use **Manage** to add holdings or watchlist tickers, then select
**Run analysis**. The dashboard works without external credentials.

## External services

### Alpaca paper account

Alpaca provides market data and the **AI shadow portfolio's paper brokerage account**.

1. Create an account at <https://alpaca.markets>.
2. Switch to **Paper Trading**, then generate an API key and secret.
3. Add the following to `.env`:

   ```text
   MARKET_ADAPTER=alpaca
   ALPACA_KEY_ID=your_key_id
   ALPACA_SECRET=your_secret
   ALPACA_PAPER=true
   ```

4. Verify the credentials:

   ```bash
   bun run alpaca:smoke
   ```

> The app refuses to start with `MARKET_ADAPTER=alpaca` unless `ALPACA_PAPER=true`. There is no
> live-money adapter or real-portfolio execution path. AI account seeding and automated paper
> execution are roadmap items, not current UI features.

### Analysis enrichment

All enrichment keys are optional. Missing keys degrade gracefully.

| Service | Purpose | Verify |
|---|---|---|
| Gemini | LLM analysis; falls back to deterministic reports without a key | `bun run gemini:smoke` |
| FMP | Fundamentals and screener candidates | `bun run fmp:smoke` |
| FRED | Rates, curve, CPI, unemployment, and VIX macro context | `bun run fred:smoke` |
| Finnhub | Analyst consensus and upcoming earnings | `bun run finnhub:smoke` |

Add keys to `.env`:

```text
GEMINI_API_KEY=your_gemini_key
FMP_API_KEY=your_fmp_key
FRED_API_KEY=your_fred_key
FINNHUB_API_KEY=your_finnhub_key
```

## Analysis behavior

- **Held positions** receive exactly one of **ADD**, **TRIM**, **HOLD**, or **SELL**.
- **Opportunities** receive **BUY**, **WATCH**, or filtered-out **PASS** results.
- **Predictions** include direction, horizon, entry, target, stop, expected return, R-multiple,
  invalidation, and WATCH trigger details.
- **Context** combines SPY technicals, macro observations, screeners, and thematic discovery.
- **Streaming** shows context gathering, tool activity, ticker progress, and completion in the UI.

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

## Architecture

```text
src/
├── analysis/      technicals, market context, universe, opportunity scan
├── config/        env loading and paper-only validation
├── db/            SQLite connection, migrations, repositories
├── domain/        Zod schemas and shared API types
├── fundamentals/  fake, FMP, and Finnhub-backed enrichment
├── llm/           Gemini adapter, prompts, normalization, schemas
├── macro/         fake and FRED-backed macro snapshots
├── market/        fake and Alpaca MarketGateway adapters
├── pipeline/      price → context/scan/analyze → persist, with live events
├── scheduler/     once-per-day automatic run trigger
└── server/        Hono HTTP API
web/               React + Vite + Tailwind + Recharts + TanStack Query
```

The frontend imports shared backend types through the `@shared` alias. Fake and Alpaca market
adapters satisfy the same `MarketGateway` contract.

## Next build

Build in this order:

1. Finish the active scheduler and contribution-neutral performance slice.
2. Persist every recommendation and add the scored-forecast journal.
3. Add explicit AI-paper seeding and guarded auto-execution, disabled by default.
4. Add the user research library for uploads, URL snapshots, and opt-in private notes.
5. Resolve forecasts from historical high/low data with corporate-action awareness.
6. Compile evidence-backed wiki lessons and calibration metrics into future prompts.

See [`docs/architecture-and-roadmap.md`](docs/architecture-and-roadmap.md) for the full design,
implementation deltas, acceptance criteria, and later phases.

## Local planning notes

The tracked architecture belongs in `docs/architecture-and-roadmap.md`. Keep private working notes,
conversation exports, and temporary implementation plans under `docs/local/`, `docs/conversations/`,
or `docs/plans/`; those directories are intentionally gitignored.
