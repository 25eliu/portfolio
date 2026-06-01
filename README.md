# Portfolio Intelligence Platform

A locally-run dashboard that mirrors your real stock holdings and runs a daily analysis pipeline,
benchmarked A/B against an AI-driven **paper** portfolio. **Paper trading only — not investment
advice.**

This repo currently implements **Phase 0 + 1** (foundations + dual-portfolio mirror): the
end-to-end skeleton, the `dailyRun` pipeline spine, the dual portfolio view with a You-vs-AI-vs-SPY
equity curve, and a structured daily report. The LLM analysis, prediction journal, resolution, and
learning loop arrive in later phases (see the design doc).

## Quickstart (no credentials needed)

The app runs fully offline against a deterministic **fake** market adapter:

```bash
bun install
cp .env.example .env          # defaults to MARKET_ADAPTER=fake
bun run db:migrate
bun run dev                   # backend :8787 + Vite :5173
```

Open http://localhost:5173 → **Manage holdings** to add tickers → **Seed AI account** →
**Run analysis now**. Both panels price up, the equity curve and recommendation cards render.

## Going live with Alpaca (paper account)

The only external service this slice needs is a **free Alpaca paper account**, which provides both
the paper brokerage (AI portfolio) and stock pricing (equity curves + SPY benchmark).

1. Sign up free at <https://alpaca.markets>.
2. Switch to **Paper Trading** (top-left account switcher), then generate an **API Key ID + Secret**.
3. In `.env` set:
   ```
   MARKET_ADAPTER=alpaca
   ALPACA_KEY_ID=your_key_id
   ALPACA_SECRET=your_secret
   ALPACA_PAPER=true
   ```
4. Verify the credentials before anything else:
   ```bash
   bun run alpaca:smoke      # GET /v2/account → prints your paper balance
   ```
5. `bun run dev`, then add holdings → **Seed AI account** (submits paper buy orders to match) →
   **Run analysis now**. Re-run on later days and the equity curve accumulates points.

> Security: keys live in `.env` only (gitignored), never in source. The app refuses to start with
> `MARKET_ADAPTER=alpaca` unless `ALPACA_PAPER=true`. There is no live-money path.

## Phase 2: analysis (Gemini + FMP)

Phase 2 replaces the deterministic fake report with a real LLM analysis step.  Two free API keys are
required:

1. **Gemini** — get a free key at <https://aistudio.google.com/apikey>
2. **FMP (Financial Modeling Prep)** — get a free key at <https://site.financialmodelingprep.com/developer/docs>

Add both to `.env`:

```
GEMINI_API_KEY=your_gemini_key
FMP_API_KEY=your_fmp_key
```

Verify each key before running the full pipeline:

```bash
bun run gemini:smoke   # calls Gemini API with a single test prompt
bun run fmp:smoke      # fetches a sample FMP endpoint
```

> **No key? No problem.** If `GEMINI_API_KEY` is absent the app falls back to the deterministic fake
> report, so the dashboard still works end-to-end without any credentials.

The Phase 2 analysis covers:

- **Held positions** — valuation + conviction score for every ticker you own
- **Watchlist** — the same analysis for tickers you are tracking but do not hold
- **Opportunity scan** — top daily movers (via market adapter), FMP screener results, and
  LLM-driven sentiment / thematic discovery across the combined universe

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Backend + Vite together |
| `bun run server` | Backend API only (:8787) |
| `bun run db:migrate` | Create/upgrade the SQLite schema |
| `bun run alpaca:smoke` | Verify Alpaca paper credentials |
| `bun run gemini:smoke` | Verify Gemini API key |
| `bun run fmp:smoke` | Verify FMP API key |
| `bun test` | Unit + integration tests (fake adapter) |
| `bunx playwright install chromium && bun run test:e2e` | Browser E2E (one-time browser install) |
| `bun run build:web` | Production frontend build |

## Architecture

```
src/
├── config/     env loading + validation (paper-only guard)
├── domain/     Zod schemas + types (Portfolio, Holding, Snapshot, Recommendation, Risk)
├── db/         bun:sqlite connection, migrations, repositories
├── market/     Broker + MarketData interfaces; fake/ + alpaca/ adapters
├── pipeline/   dailyRun spine: price → fake report → persist; seed; pricing
├── server/     Hono HTTP API (/api/*)
└── app.ts      wires db + gateway + bootstraps the two portfolios
web/            React + Vite + Tailwind + Recharts + TanStack Query dashboard
```

The frontend shares backend types via the `@shared` alias (one source of truth for the API
contract). The `MarketGateway` interface means the fake and Alpaca adapters are interchangeable —
swap with a single env var.

## Status & roadmap

Phase 0+1 done. Next: **Phase 2** wires the LLM analysis step (provider-agnostic, Gemini default)
in place of the current fake report generator; **Phase 3** adds the prediction journal, resolution,
and real AI trade execution.
