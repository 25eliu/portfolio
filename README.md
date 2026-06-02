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

## Phase 2: analysis (Gemini + FMP + FRED + Finnhub)

Phase 2 replaces the deterministic fake report with a real LLM analysis step.  All four API keys
are **free** and the app degrades gracefully without any of them:

1. **Gemini** — get a free key at <https://aistudio.google.com/apikey>
2. **FMP (Financial Modeling Prep)** — get a free key at <https://site.financialmodelingprep.com/developer/docs>
3. **FRED** — get a free key at <https://fred.stlouisfed.org/docs/api/api_key.html> (macro rates, CPI, unemployment, VIX)
4. **Finnhub** — get a free key at <https://finnhub.io> (analyst consensus + next earnings date)

Add all four to `.env`:

```
GEMINI_API_KEY=your_gemini_key
FMP_API_KEY=your_fmp_key
FRED_API_KEY=your_fred_key
FINNHUB_API_KEY=your_finnhub_key
```

Verify each key before running the full pipeline:

```bash
bun run gemini:smoke    # calls Gemini API with a single test prompt
bun run fmp:smoke       # fetches a sample FMP endpoint
bun run fred:smoke      # fetches latest FRED macro series (10y, 2y, VIX, CPI, unemployment)
bun run finnhub:smoke   # fetches analyst consensus + earnings calendar for a sample ticker
```

> **No key? No problem.** Each data source degrades gracefully when its key is absent: Gemini falls
> back to the deterministic fake report; FRED falls back to a fake macro snapshot; Finnhub simply
> skips analyst/earnings enrichment. The dashboard works end-to-end without any credentials.

The Phase 2 analysis covers:

- **Your positions** — for every ticker you hold, the AI returns exactly one of: **ADD** (buy more),
  **TRIM** (reduce), **HOLD** (keep), or **SELL** (exit). It never returns WATCH/BUY on a held name.
- **Opportunities** — for tickers you are tracking or discovered via scan, the AI returns **BUY**
  (enter now), **WATCH** (clear thesis, needs a concrete trigger), or filters out **PASS** results
  so only actionable ideas surface.
- **Forward-looking predictions** — every recommendation carries a structured prediction with
  direction (bullish/bearish/neutral), horizon (1d → 1y), entry, target, stop, expected return %,
  R-multiple, trigger + action-if-triggered (for WATCH), and an invalidation condition.
- **Macro context** — FRED feeds live 10y/2y yields, yield curve spread, Fed Funds rate, CPI YoY,
  unemployment rate, and VIX into both the market-regime summary and each per-ticker analysis.
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
| `bun run fred:smoke` | Verify FRED API key (prints latest macro snapshot) |
| `bun run finnhub:smoke` | Verify Finnhub API key (analyst consensus + earnings) |
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
