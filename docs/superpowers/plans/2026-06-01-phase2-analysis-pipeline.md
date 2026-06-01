# Phase 2 — Real Analysis Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder daily report with genuine, industry-standard equity analysis — technicals (Alpaca) + fundamentals (FMP) + grounded LLM reasoning (Gemini 3.1 Pro) — producing a structured, citation-backed daily report. Manual trigger, no trade execution.

**Architecture:** Three external data sources, each behind a narrow interface with a deterministic fake adapter (Alpaca market gateway already exists; add an FMP `Fundamentals` client and a Gemini `Analyzer`). Pure indicator math computes technicals from bars. `dailyRun` step 3 swaps `generateFakeReport` → `generateLlmReport`, which builds a universe (held ∪ watchlist ∪ opportunity scan), fans out per-ticker grounded analysis with bounded concurrency, and assembles the report. No key present → falls back to the fake generator so tests/offline still work.

**Tech Stack:** Bun, TypeScript, `@google/genai`, Zod, `bun:sqlite`, Hono, React (existing design system).

---

## File structure (created / modified)

```
src/
├── config/env.ts                       MODIFY  add GEMINI_*/FMP_*/LLM_* vars
├── domain/
│   ├── technicals.ts                   CREATE  full Technicals schema (replaces inline one)
│   ├── fundamentals.ts                 CREATE  Fundamentals schema
│   ├── marketContext.ts                CREATE  MarketContext schema
│   ├── watchlist.ts                    CREATE  WatchlistItem schema
│   ├── scan.ts                         CREATE  ScanCandidate schema
│   ├── recommendation.ts               MODIFY  enrich Recommendation + DailyReport
│   └── index.ts                        MODIFY  re-export new modules
├── db/
│   ├── schema.ts                       MODIFY  migration 002 (watchlist, fundamentals_cache)
│   └── repositories/
│       ├── watchlist.ts                CREATE
│       └── fundamentalsCache.ts        CREATE
├── market/
│   ├── types.ts                        MODIFY  getBars(lookbackDays) + getMovers
│   ├── fake/index.ts                   MODIFY  bar history + deterministic movers
│   └── alpaca/index.ts                 MODIFY  bars start-date + movers endpoint
├── fundamentals/
│   ├── types.ts                        CREATE  Fundamentals interface + DTOs
│   ├── fmp/index.ts                    CREATE  FMP REST adapter
│   ├── fake/index.ts                   CREATE  deterministic adapter
│   └── index.ts                        CREATE  factory (fmp|fake) + daily cache wrapper
├── analysis/
│   ├── technicals.ts                   CREATE  pure indicator math
│   ├── opportunityScan.ts              CREATE  movers + FMP screens → candidates
│   ├── universe.ts                     CREATE  held ∪ watchlist ∪ scan, dedupe+cap
│   └── marketContext.ts                CREATE  SPY trend + grounded macro
├── llm/
│   ├── schema.ts                       CREATE  Recommendation → Gemini function declaration
│   ├── prompts.ts                      CREATE  prompt builders
│   ├── analyze.ts                      CREATE  Analyzer interface + mock
│   └── gemini.ts                       CREATE  @google/genai grounded+function-tool call
├── pipeline/
│   ├── llmReport.ts                    CREATE  generateLlmReport
│   └── dailyRun.ts                     MODIFY  call generateLlmReport (fake fallback)
├── app.ts                              MODIFY  wire analyzer + fundamentals into App
└── server/routes/watchlist.ts          CREATE  + mount in server/app.ts
scripts/
├── gemini-smoke.ts                     CREATE  spike: grounding + structured output
└── fmp-smoke.ts                        CREATE  FMP credential check
web/ (extend existing design system)    MODIFY  market-context banner, richer card, watchlist UI
playwright.config.ts                    MODIFY  force MARKET_ADAPTER=fake for E2E
.env.example / README.md                MODIFY  FMP + Gemini setup
```

---

## Task 1: Config, dependencies, and E2E safety

**Files:**
- Modify: `package.json` (add dep), `src/config/env.ts`, `.env.example`, `playwright.config.ts`
- Test: `src/config/env.test.ts`

- [ ] **Step 1: Add the Gemini SDK**

Run: `bun add @google/genai`
Expected: package added to dependencies.

- [ ] **Step 2: Write failing tests for the new env vars**

Add to `src/config/env.test.ts` inside the existing `describe("loadEnv", ...)`:

```ts
test("defaults the Phase 2 analysis knobs", () => {
  const e = loadEnv({});
  expect(e.GEMINI_MODEL).toBe("gemini-3.1-pro-preview");
  expect(e.GEMINI_THINKING_LEVEL).toBe("medium");
  expect(e.LLM_CONCURRENCY).toBe(4);
  expect(e.MAX_SCAN_CANDIDATES).toBe(8);
  expect(e.GEMINI_API_KEY).toBe("");
  expect(e.FMP_API_KEY).toBe("");
});

test("coerces LLM_CONCURRENCY and MAX_SCAN_CANDIDATES", () => {
  const e = loadEnv({ LLM_CONCURRENCY: "8", MAX_SCAN_CANDIDATES: "12" });
  expect(e.LLM_CONCURRENCY).toBe(8);
  expect(e.MAX_SCAN_CANDIDATES).toBe(12);
});

test("rejects an invalid thinking level", () => {
  expect(() => loadEnv({ GEMINI_THINKING_LEVEL: "ultra" })).toThrow(/Invalid environment/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/config/`
Expected: FAIL (new fields undefined).

- [ ] **Step 4: Add the fields to the env schema**

In `src/config/env.ts`, add to the `EnvSchema` object (after `DATABASE_PATH`):

```ts
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-3.1-pro-preview"),
  GEMINI_THINKING_LEVEL: z.enum(["low", "medium", "high"]).default("medium"),
  FMP_API_KEY: z.string().default(""),
  LLM_CONCURRENCY: z.coerce.number().int().positive().default(4),
  MAX_SCAN_CANDIDATES: z.coerce.number().int().nonnegative().default(8),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/config/`
Expected: PASS.

- [ ] **Step 6: Update `.env.example`**

Append to `.env.example`:

```
# --- Phase 2: analysis ---
# Gemini (https://aistudio.google.com/apikey)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-pro-preview
GEMINI_THINKING_LEVEL=medium
# Financial Modeling Prep free tier (https://site.financialmodelingprep.com/developer/docs)
FMP_API_KEY=
# Analysis tuning
LLM_CONCURRENCY=4
MAX_SCAN_CANDIDATES=8
```

- [ ] **Step 7: Force the fake adapter for E2E (prevents real paper-account mutation)**

In `playwright.config.ts`, change the `webServer` block to inject env:

```ts
  webServer: {
    command: "bun run dev",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 30_000,
    env: { MARKET_ADAPTER: "fake", DATABASE_PATH: "./data/e2e.sqlite", GEMINI_API_KEY: "", FMP_API_KEY: "" },
  },
```

Note: `reuseExistingServer: false` ensures the E2E run starts its own fake-adapter server rather than reusing your live `alpaca` dev server.

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock src/config/env.ts src/config/env.test.ts .env.example playwright.config.ts
git commit -m "feat(config): add Gemini/FMP env + force fake adapter for E2E"
```

---

## Task 2: Market data — bar history + movers

**Files:**
- Modify: `src/market/types.ts`, `src/market/fake/index.ts`, `src/market/alpaca/index.ts`
- Test: `src/market/fake/fake.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/market/fake/fake.test.ts`:

```ts
test("getBars returns the full lookback window of history", async () => {
  const gw = createFakeGateway({ now: clock });
  const bars = await gw.getBars("AAPL", 250);
  expect(bars.length).toBe(250);
  expect(bars[0]!.date < bars[249]!.date).toBe(true);
  expect(bars[249]!.date).toBe(FIXED);
});

test("getMovers returns a deterministic candidate set", async () => {
  const gw = createFakeGateway({ now: clock });
  const movers = await gw.getMovers(5);
  expect(movers.length).toBe(5);
  expect(movers.every((m) => typeof m.symbol === "string" && m.changePct != null)).toBe(true);
  const again = await gw.getMovers(5);
  expect(again.map((m) => m.symbol)).toEqual(movers.map((m) => m.symbol));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/market/`
Expected: FAIL (`getMovers` not a function; type error on signature).

- [ ] **Step 3: Extend the interfaces in `src/market/types.ts`**

Add a `Mover` type and extend `MarketData`:

```ts
export type Mover = { symbol: string; price: number; changePct: number; volume: number };
```

Change the `getBars` signature and add `getMovers` to the `MarketData` interface:

```ts
export interface MarketData {
  getQuote(symbol: string): Promise<Quote>;
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getBars(symbol: string, lookbackDays: number): Promise<Bar[]>;
  getMovers(limit: number): Promise<Mover[]>;
}
```

(The `getBars(symbol, days)` name is unchanged; `days` now means the lookback window — the fake already honors it; the Alpaca adapter is fixed in Step 5.)

- [ ] **Step 4: Implement in the fake adapter**

In `src/market/fake/index.ts`, the existing `getBars` already produces `days` bars ending today — no change needed. Add `getMovers` to the returned `marketData` object:

```ts
    async getMovers(limit: number): Promise<import("../types.ts").Mover[]> {
      const pool = ["NVDA", "TSLA", "AMD", "AAPL", "META", "AMZN", "MSFT", "GOOGL", "NFLX", "AVGO"];
      return pool.slice(0, limit).map((symbol) => {
        const today = now();
        const prev = fakePrice(symbol, `${today}~prev`);
        const price = fakePrice(symbol, today);
        return {
          symbol,
          price,
          changePct: Math.round(((price - prev) / prev) * 10000) / 100,
          volume: 5_000_000,
        };
      });
    },
```

- [ ] **Step 5: Fix the Alpaca adapter — send a start date and add movers**

In `src/market/alpaca/index.ts`, replace the `getBars` body so it computes a `start` date from the lookback (calendar days back from today, ISO date):

```ts
    async getBars(symbol: string, lookbackDays: number): Promise<Bar[]> {
      const start = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
      const raw = await request(
        env.ALPACA_DATA_BASE_URL,
        `/v2/stocks/${symbol}/bars?timeframe=1Day&start=${start}&limit=10000&feed=iex&adjustment=split`,
      );
      const parsed = BarsRes.parse(raw);
      return (parsed.bars ?? []).map((b) => ({
        date: b.t.slice(0, 10),
        open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
      }));
    },
```

Add `getMovers` to the returned object (Alpaca most-actives endpoint):

```ts
    async getMovers(limit: number): Promise<import("../types.ts").Mover[]> {
      const raw = await request(
        env.ALPACA_DATA_BASE_URL,
        `/v1beta1/screener/stocks/most-actives?top=${limit}`,
      );
      const Schema = z.object({
        most_actives: z.array(z.object({ symbol: z.string(), volume: z.number(), trade_count: z.number().optional() })).default([]),
      });
      const actives = Schema.parse(raw).most_actives.slice(0, limit);
      const quotes = await this.getQuotes(actives.map((a) => a.symbol));
      const priceOf = new Map(quotes.map((q) => [q.symbol, q.price]));
      return actives.map((a) => ({ symbol: a.symbol, price: priceOf.get(a.symbol) ?? 0, changePct: 0, volume: a.volume }));
    },
```

Note: `most-actives` does not return a change %, so `changePct` is left 0 here; momentum ranking uses computed technicals later. Keep it simple.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/market/`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

Run: `bunx tsc --noEmit` (expect clean)

```bash
git add src/market/
git commit -m "feat(market): bar history lookback + most-actives movers"
```

---

## Task 3: Technicals domain schema + indicator math

**Files:**
- Create: `src/domain/technicals.ts`, `src/analysis/technicals.ts`
- Modify: `src/domain/recommendation.ts` (use the new Technicals), `src/domain/index.ts`
- Test: `src/analysis/technicals.test.ts`

- [ ] **Step 1: Create the expanded Technicals schema**

Create `src/domain/technicals.ts`:

```ts
import { z } from "zod";

const num = z.number().nullable().default(null);

export const Technicals = z.object({
  price: num,
  sma20: num, sma50: num, sma200: num,
  ema20: num, ema50: num, ema200: num,
  priceVsSma200Pct: num,
  goldenCross: z.boolean().nullable().default(null),
  rsi14: num,
  macd: num, macdSignal: num, macdHist: num,
  stochK: num, stochD: num,
  atr14: num,
  bbUpper: num, bbLower: num, bbPercentB: num,
  high52w: num, low52w: num, pctFrom52wHigh: num, pctFrom52wLow: num,
  avgVolume20: num, relativeVolume: num,
  obv: num, vwap: num, beta: num,
  support: num, resistance: num,
});
export type Technicals = z.infer<typeof Technicals>;

/** A zero-value technicals object (all nulls) for safe defaults. */
export const emptyTechnicals = (): Technicals => Technicals.parse({});
```

- [ ] **Step 2: Point Recommendation at the new schema**

In `src/domain/recommendation.ts`, remove the inline `Technicals` definition and import it instead. Replace the local `Technicals` const + type with:

```ts
import { Technicals } from "./technicals.ts";
```

Leave the `technicals: Technicals` field in `Recommendation` as-is (it now references the imported schema). Add `export * from "./technicals.ts";` to `src/domain/index.ts`.

- [ ] **Step 3: Write failing tests for the math (property-based, no fragile magic numbers)**

Create `src/analysis/technicals.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { Bar } from "../market/types.ts";
import { computeTechnicals, ema, rsi, sma } from "./technicals.ts";

const bar = (date: string, c: number, v = 1_000_000): Bar => ({
  date, open: c, high: c, low: c, close: c, volume: v,
});
const series = (closes: number[]): Bar[] =>
  closes.map((c, i) => bar(`2026-01-${String(i + 1).padStart(2, "0")}`, c));

describe("sma", () => {
  test("simple average of the last n", () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBe(3);
    expect(sma([2, 4, 6], 2)).toBe(5);
  });
  test("null when not enough data", () => {
    expect(sma([1, 2], 5)).toBeNull();
  });
});

describe("ema", () => {
  test("constant series equals the constant", () => {
    expect(ema([5, 5, 5, 5, 5], 3)).toBeCloseTo(5, 6);
  });
});

describe("rsi", () => {
  test("monotonically rising series → 100", () => {
    const up = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(rsi(up, 14)).toBeCloseTo(100, 4);
  });
  test("flat series → 50", () => {
    expect(rsi(Array(20).fill(7), 14)).toBe(50);
  });
});

describe("computeTechnicals", () => {
  test("fills indicators on a long enough series", () => {
    const closes = Array.from({ length: 220 }, (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1);
    const t = computeTechnicals(series(closes), 1.0);
    expect(t.price).toBeCloseTo(closes.at(-1)!, 6);
    expect(t.sma20).not.toBeNull();
    expect(t.sma200).not.toBeNull();
    expect(t.rsi14).toBeGreaterThanOrEqual(0);
    expect(t.rsi14).toBeLessThanOrEqual(100);
    expect(t.high52w).toBeGreaterThanOrEqual(t.low52w!);
  });
  test("degrades to nulls on short series (no throw)", () => {
    const t = computeTechnicals(series([10, 11, 12]), null);
    expect(t.price).toBe(12);
    expect(t.sma200).toBeNull();
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `bun test src/analysis/technicals.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 5: Implement the indicator math**

Create `src/analysis/technicals.ts`:

```ts
import type { Bar } from "../market/types.ts";
import { type Technicals, emptyTechnicals } from "../domain/technicals.ts";

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export function sma(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const slice = values.slice(-n);
  return round(slice.reduce((a, b) => a + b, 0) / n);
}

export function ema(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const k = 2 / (n + 1);
  let e = values.slice(0, n).reduce((a, b) => a + b, 0) / n; // seed with SMA
  for (let i = n; i < values.length; i++) e = values[i]! * k + e * (1 - k);
  return round(e);
}

export function rsi(values: number[], n = 14): number | null {
  if (values.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = values.length - n; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (gain + loss === 0) return 50;
  if (loss === 0) return 100;
  const rs = gain / loss;
  return round(100 - 100 / (1 + rs), 2);
}

function macd(values: number[]): { macd: number | null; signal: number | null; hist: number | null } {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  if (fast == null || slow == null) return { macd: null, signal: null, hist: null };
  // signal = EMA9 of the MACD line; approximate using the last 35 closes' MACD series
  const line: number[] = [];
  for (let i = 26; i <= values.length; i++) {
    const f = ema(values.slice(0, i), 12);
    const s = ema(values.slice(0, i), 26);
    if (f != null && s != null) line.push(f - s);
  }
  const m = round(fast - slow);
  const signal = ema(line, 9);
  return { macd: m, signal, hist: signal == null ? null : round(m - signal) };
}

function atr(bars: Bar[], n = 14): number | null {
  if (bars.length < n + 1) return null;
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i]!.high, l = bars[i]!.low, pc = bars[i - 1]!.close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return sma(tr, n);
}

function stdev(values: number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

export function computeTechnicals(bars: Bar[], beta: number | null): Technicals {
  const t = emptyTechnicals();
  if (bars.length === 0) return t;
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume);
  const price = closes.at(-1)!;
  t.price = round(price);
  t.beta = beta;
  t.sma20 = sma(closes, 20); t.sma50 = sma(closes, 50); t.sma200 = sma(closes, 200);
  t.ema20 = ema(closes, 20); t.ema50 = ema(closes, 50); t.ema200 = ema(closes, 200);
  if (t.sma200 != null) t.priceVsSma200Pct = round(((price - t.sma200) / t.sma200) * 100, 2);
  if (t.sma50 != null && t.sma200 != null) t.goldenCross = t.sma50 > t.sma200;
  t.rsi14 = rsi(closes, 14);
  const m = macd(closes);
  t.macd = m.macd; t.macdSignal = m.signal; t.macdHist = m.hist;
  t.atr14 = atr(bars, 14);
  if (closes.length >= 20) {
    const window = closes.slice(-20);
    const mid = window.reduce((a, b) => a + b, 0) / 20;
    const sd = stdev(window);
    t.bbUpper = round(mid + 2 * sd); t.bbLower = round(mid - 2 * sd);
    t.bbPercentB = sd === 0 ? null : round((price - t.bbLower) / (t.bbUpper - t.bbLower), 4);
  }
  const window52 = bars.slice(-252);
  t.high52w = round(Math.max(...window52.map((b) => b.high)));
  t.low52w = round(Math.min(...window52.map((b) => b.low)));
  t.pctFrom52wHigh = round(((price - t.high52w) / t.high52w) * 100, 2);
  t.pctFrom52wLow = round(((price - t.low52w) / t.low52w) * 100, 2);
  t.avgVolume20 = sma(vols, 20);
  t.relativeVolume = t.avgVolume20 ? round(vols.at(-1)! / t.avgVolume20, 2) : null;
  // OBV
  let obv = 0;
  for (let i = 1; i < bars.length; i++) obv += bars[i]!.close > bars[i - 1]!.close ? bars[i]!.volume : bars[i]!.close < bars[i - 1]!.close ? -bars[i]!.volume : 0;
  t.obv = obv;
  // VWAP over the window (typical price)
  const recent = bars.slice(-20);
  const pv = recent.reduce((a, b) => a + ((b.high + b.low + b.close) / 3) * b.volume, 0);
  const vv = recent.reduce((a, b) => a + b.volume, 0);
  t.vwap = vv ? round(pv / vv) : null;
  // Support/resistance from recent swing low/high (last 20)
  t.support = round(Math.min(...recent.map((b) => b.low)));
  t.resistance = round(Math.max(...recent.map((b) => b.high)));
  return t;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/analysis/technicals.test.ts`
Expected: PASS.

- [ ] **Step 7: Fix any domain test fallout + commit**

Run: `bun test src/domain/ && bunx tsc --noEmit`
Expected: PASS / clean. (The old recommendation test built a small `technicals` object; the new schema defaults all fields to null, so a partial object still parses.)

```bash
git add src/domain/technicals.ts src/domain/recommendation.ts src/domain/index.ts src/analysis/technicals.ts src/analysis/technicals.test.ts
git commit -m "feat(analysis): full technical indicator suite + expanded Technicals schema"
```

---

## Task 4: Fundamentals — schema, FMP client, fake adapter, daily cache

**Files:**
- Create: `src/domain/fundamentals.ts`, `src/fundamentals/types.ts`, `src/fundamentals/fmp/index.ts`, `src/fundamentals/fake/index.ts`, `src/fundamentals/index.ts`, `src/db/repositories/fundamentalsCache.ts`
- Modify: `src/db/schema.ts` (migration 002), `src/db/index.ts`, `src/domain/index.ts`
- Test: `src/fundamentals/fundamentals.test.ts`

- [ ] **Step 1: Create the Fundamentals schema**

Create `src/domain/fundamentals.ts`:

```ts
import { z } from "zod";
const num = z.number().nullable().default(null);

export const Fundamentals = z.object({
  symbol: z.string(),
  name: z.string().nullable().default(null),
  sector: z.string().nullable().default(null),
  marketCap: num,
  peTrailing: num, peForward: num, ps: num, pb: num, peg: num, evEbitda: num,
  fcfYield: num, dividendYield: num,
  grossMargin: num, operatingMargin: num, netMargin: num, roe: num, roa: num, roic: num,
  revenueGrowthYoY: num, epsGrowthYoY: num,
  debtToEquity: num, currentRatio: num, quickRatio: num, freeCashFlow: num, interestCoverage: num,
  analystRating: z.string().nullable().default(null),
  priceTargetMean: num, priceTargetHigh: num, priceTargetLow: num, numAnalysts: num,
  nextEarningsDate: z.string().nullable().default(null),
});
export type Fundamentals = z.infer<typeof Fundamentals>;

export const emptyFundamentals = (symbol: string): Fundamentals => Fundamentals.parse({ symbol });
```

Add `export * from "./fundamentals.ts";` to `src/domain/index.ts`.

- [ ] **Step 2: Define the Fundamentals interface + screen criteria**

Create `src/fundamentals/types.ts`:

```ts
import type { Fundamentals } from "../domain/fundamentals.ts";

export type ScreenCriteria = {
  betaMoreThan?: number;
  marketCapMoreThan?: number;
  volumeMoreThan?: number;
  peLowerThan?: number;
  roeMoreThan?: number;
  limit?: number;
};

export interface FundamentalsSource {
  readonly kind: "fmp" | "fake";
  get(symbol: string): Promise<Fundamentals>;
  screen(criteria: ScreenCriteria): Promise<string[]>; // returns symbols
}
```

- [ ] **Step 3: Write failing tests against the fake adapter + cache**

Create `src/fundamentals/fundamentals.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { openMemoryDb, repositories } from "../db/index.ts";
import { createFakeFundamentals } from "./fake/index.ts";
import { cached } from "./index.ts";
import { Fundamentals } from "../domain/fundamentals.ts";

describe("fake fundamentals", () => {
  test("returns a schema-valid, deterministic object", async () => {
    const f = createFakeFundamentals();
    const a = await f.get("AAPL");
    expect(() => Fundamentals.parse(a)).not.toThrow();
    expect(a.symbol).toBe("AAPL");
    const b = await f.get("AAPL");
    expect(b.peTrailing).toBe(a.peTrailing);
  });
  test("screen returns symbols", async () => {
    const f = createFakeFundamentals();
    expect((await f.screen({ limit: 3 })).length).toBeGreaterThan(0);
  });
});

describe("daily cache", () => {
  test("fetches once per (symbol, date), then serves from cache", async () => {
    const repos = repositories(openMemoryDb());
    let calls = 0;
    const source = {
      kind: "fake" as const,
      async get(symbol: string) { calls++; return Fundamentals.parse({ symbol }); },
      async screen() { return []; },
    };
    const c = cached(source, repos, () => "2026-06-01");
    await c.get("AAPL");
    await c.get("AAPL");
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `bun test src/fundamentals/`
Expected: FAIL (modules missing).

- [ ] **Step 5: Migration 002 — fundamentals_cache table**

In `src/db/schema.ts`, append to the `MIGRATIONS` array (after `001_init`):

```ts
  {
    name: "002_phase2",
    sql: `
      CREATE TABLE fundamentals_cache (
        symbol     TEXT NOT NULL,
        date       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        PRIMARY KEY (symbol, date)
      );

      CREATE TABLE watchlist (
        id     TEXT PRIMARY KEY,
        symbol TEXT NOT NULL UNIQUE,
        note   TEXT
      );
    `,
  },
```

- [ ] **Step 6: Fundamentals cache repo**

Create `src/db/repositories/fundamentalsCache.ts`:

```ts
import type { DB } from "../connection.ts";
import { Fundamentals } from "../../domain/index.ts";

type Row = { payload: string };

export function fundamentalsCacheRepo(db: DB) {
  return {
    get(symbol: string, date: string): Fundamentals | null {
      const row = db
        .query<Row, [string, string]>("SELECT payload FROM fundamentals_cache WHERE symbol = ? AND date = ?")
        .get(symbol, date);
      return row ? Fundamentals.parse(JSON.parse(row.payload)) : null;
    },
    put(symbol: string, date: string, f: Fundamentals): void {
      db.query(
        `INSERT INTO fundamentals_cache (symbol, date, payload) VALUES (?, ?, ?)
         ON CONFLICT (symbol, date) DO UPDATE SET payload = excluded.payload`,
      ).run(symbol, date, JSON.stringify(Fundamentals.parse(f)));
    },
  };
}
export type FundamentalsCacheRepo = ReturnType<typeof fundamentalsCacheRepo>;
```

Wire it into `src/db/index.ts`: import `fundamentalsCacheRepo` and add `fundamentalsCache: fundamentalsCacheRepo(db),` to the `repositories()` return object. (The watchlist repo is added in Task 8.)

- [ ] **Step 7: Fake fundamentals adapter**

Create `src/fundamentals/fake/index.ts`:

```ts
import { Fundamentals, type Fundamentals as F } from "../../domain/fundamentals.ts";
import type { FundamentalsSource, ScreenCriteria } from "../types.ts";

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function createFakeFundamentals(): FundamentalsSource {
  return {
    kind: "fake",
    async get(symbol: string): Promise<F> {
      const s = hash(symbol);
      return Fundamentals.parse({
        symbol,
        name: `${symbol} Inc.`,
        sector: ["Tech", "Health", "Energy", "Financials"][s % 4],
        marketCap: 1e9 + (s % 900) * 1e9,
        peTrailing: 10 + (s % 40),
        peForward: 9 + (s % 35),
        ps: 1 + (s % 12), pb: 1 + (s % 8), peg: 0.8 + (s % 30) / 10, evEbitda: 6 + (s % 20),
        fcfYield: round2((s % 80) / 10), dividendYield: round2((s % 40) / 10),
        grossMargin: 30 + (s % 50), operatingMargin: 10 + (s % 30), netMargin: 5 + (s % 25),
        roe: 5 + (s % 35), roa: 2 + (s % 18), roic: 4 + (s % 25),
        revenueGrowthYoY: -10 + (s % 60), epsGrowthYoY: -15 + (s % 70),
        debtToEquity: round2((s % 200) / 100), currentRatio: 1 + (s % 30) / 10,
        quickRatio: 0.8 + (s % 25) / 10, freeCashFlow: (s % 500) * 1e7, interestCoverage: 2 + (s % 30),
        analystRating: ["Strong Buy", "Buy", "Hold", "Sell"][s % 4],
        priceTargetMean: 50 + (s % 300), priceTargetHigh: 60 + (s % 320), priceTargetLow: 40 + (s % 250),
        numAnalysts: 3 + (s % 25),
        nextEarningsDate: null,
      });
    },
    async screen(criteria: ScreenCriteria): Promise<string[]> {
      const pool = ["NVDA", "AMD", "AAPL", "MSFT", "GOOGL", "META", "AMZN", "TSLA", "AVGO", "CRM"];
      return pool.slice(0, criteria.limit ?? 5);
    },
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;
```

- [ ] **Step 8: Cache wrapper + factory**

Create `src/fundamentals/index.ts`:

```ts
import type { Env } from "../config/env.ts";
import type { Repositories } from "../db/index.ts";
import { today } from "../domain/ids.ts";
import { createFakeFundamentals } from "./fake/index.ts";
import { createFmpFundamentals } from "./fmp/index.ts";
import type { FundamentalsSource } from "./types.ts";

export * from "./types.ts";

/** Wrap a source with a per-day SQLite cache so each symbol is fetched at most once per day. */
export function cached(
  source: FundamentalsSource,
  repos: Repositories,
  now: () => string = today,
): FundamentalsSource {
  return {
    kind: source.kind,
    async get(symbol) {
      const date = now();
      const hit = repos.fundamentalsCache.get(symbol, date);
      if (hit) return hit;
      const fresh = await source.get(symbol);
      repos.fundamentalsCache.put(symbol, date, fresh);
      return fresh;
    },
    screen: (c) => source.screen(c),
  };
}

export function createFundamentals(env: Env): FundamentalsSource {
  return env.FMP_API_KEY ? createFmpFundamentals(env) : createFakeFundamentals();
}
```

- [ ] **Step 9: FMP adapter (real)**

Create `src/fundamentals/fmp/index.ts`:

```ts
import { z } from "zod";
import type { Env } from "../../config/env.ts";
import { Fundamentals, emptyFundamentals } from "../../domain/fundamentals.ts";
import type { FundamentalsSource, ScreenCriteria } from "../types.ts";

const BASE = "https://financialmodelingprep.com/api/v3";
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function createFmpFundamentals(env: Env): FundamentalsSource {
  const key = env.FMP_API_KEY;
  async function fmp(path: string, params = ""): Promise<unknown> {
    const sep = params ? "&" : "";
    const res = await fetch(`${BASE}${path}?apikey=${key}${sep}${params}`);
    if (!res.ok) throw new Error(`FMP ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }
  const first = (x: unknown): any => (Array.isArray(x) ? x[0] ?? {} : x ?? {});

  return {
    kind: "fmp",
    async get(symbol: string): Promise<Fundamentals> {
      const out = emptyFundamentals(symbol);
      try {
        const [profile, ratios, metrics, growth, target] = await Promise.all([
          fmp(`/profile/${symbol}`).then(first).catch(() => ({})),
          fmp(`/ratios-ttm/${symbol}`).then(first).catch(() => ({})),
          fmp(`/key-metrics-ttm/${symbol}`).then(first).catch(() => ({})),
          fmp(`/financial-growth/${symbol}`, "limit=1").then(first).catch(() => ({})),
          fmp(`/price-target-consensus/${symbol}`).then(first).catch(() => ({})),
        ]);
        out.name = typeof profile.companyName === "string" ? profile.companyName : null;
        out.sector = typeof profile.sector === "string" ? profile.sector : null;
        out.marketCap = n(profile.mktCap); out.beta = undefined as never; // beta lives in technicals
        out.peTrailing = n(ratios.priceEarningsRatioTTM);
        out.ps = n(ratios.priceToSalesRatioTTM); out.pb = n(ratios.priceToBookRatioTTM);
        out.peg = n(ratios.pegRatioTTM); out.evEbitda = n(metrics.enterpriseValueOverEBITDATTM);
        out.dividendYield = n(ratios.dividendYielPercentageTTM) ?? n(ratios.dividendYieldTTM);
        out.grossMargin = pct(ratios.grossProfitMarginTTM); out.operatingMargin = pct(ratios.operatingProfitMarginTTM);
        out.netMargin = pct(ratios.netProfitMarginTTM); out.roe = pct(ratios.returnOnEquityTTM);
        out.roa = pct(ratios.returnOnAssetsTTM); out.roic = pct(metrics.roicTTM);
        out.debtToEquity = n(ratios.debtEquityRatioTTM); out.currentRatio = n(ratios.currentRatioTTM);
        out.quickRatio = n(ratios.quickRatioTTM); out.freeCashFlow = n(metrics.freeCashFlowPerShareTTM);
        out.fcfYield = pct(metrics.freeCashFlowYieldTTM);
        out.revenueGrowthYoY = pct(growth.revenueGrowth); out.epsGrowthYoY = pct(growth.epsgrowth);
        out.priceTargetMean = n(target.targetConsensus); out.priceTargetHigh = n(target.targetHigh);
        out.priceTargetLow = n(target.targetLow);
      } catch (err) {
        // Premium/blocked endpoints degrade to nulls; never fatal.
      }
      return Fundamentals.parse(out);
    },
    async screen(criteria: ScreenCriteria): Promise<string[]> {
      const parts: string[] = [];
      if (criteria.marketCapMoreThan) parts.push(`marketCapMoreThan=${criteria.marketCapMoreThan}`);
      if (criteria.betaMoreThan) parts.push(`betaMoreThan=${criteria.betaMoreThan}`);
      if (criteria.volumeMoreThan) parts.push(`volumeMoreThan=${criteria.volumeMoreThan}`);
      if (criteria.peLowerThan) parts.push(`peLowerThan=${criteria.peLowerThan}`);
      if (criteria.roeMoreThan) parts.push(`returnOnEquityMoreThan=${criteria.roeMoreThan}`);
      parts.push(`isActivelyTrading=true`, `limit=${criteria.limit ?? 10}`);
      try {
        const raw = await fmp(`/stock-screener`, parts.join("&"));
        const Row = z.object({ symbol: z.string() });
        return z.array(Row).parse(raw).map((r) => r.symbol);
      } catch {
        return [];
      }
    },
  };
}
const pct = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10000) / 100 : null);
```

Note: FMP field names vary by plan; the spike (`fmp:smoke`) confirms exact keys. The `n()`/`pct()` helpers keep unknown fields null. Remove the `out.beta = undefined as never` line — beta is sourced from technicals, not fundamentals. (Drop that line; it is illustrative of "do not set beta here".)

- [ ] **Step 10: Run tests to verify they pass**

Run: `bun test src/fundamentals/`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/domain/fundamentals.ts src/domain/index.ts src/fundamentals/ src/db/schema.ts src/db/repositories/fundamentalsCache.ts src/db/index.ts src/fundamentals/fundamentals.test.ts
git commit -m "feat(fundamentals): FMP client + fake adapter + daily cache"
```

---

## Task 5: Opportunity scan + universe builder

**Files:**
- Create: `src/domain/scan.ts`, `src/analysis/opportunityScan.ts`, `src/analysis/universe.ts`
- Modify: `src/domain/index.ts`
- Test: `src/analysis/universe.test.ts`

- [ ] **Step 1: ScanCandidate schema**

Create `src/domain/scan.ts`:

```ts
import { z } from "zod";
export const ScreenType = z.enum(["momentum", "mean_reversion", "value", "quality_growth", "catalyst"]);
export type ScreenType = z.infer<typeof ScreenType>;
export const ScanCandidate = z.object({
  symbol: z.string(),
  screen: ScreenType,
  reason: z.string(),
});
export type ScanCandidate = z.infer<typeof ScanCandidate>;
```

Add `export * from "./scan.ts";` to `src/domain/index.ts`.

- [ ] **Step 2: Write failing tests**

Create `src/analysis/universe.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createFakeGateway } from "../market/index.ts";
import { createFakeFundamentals } from "../fundamentals/index.ts";
import { runOpportunityScan } from "./opportunityScan.ts";
import { buildUniverse } from "./universe.ts";

const clock = () => "2026-06-01";

describe("opportunity scan", () => {
  test("produces capped, typed candidates", async () => {
    const gw = createFakeGateway({ now: clock });
    const f = createFakeFundamentals();
    const candidates = await runOpportunityScan(gw, f, 6);
    expect(candidates.length).toBeLessThanOrEqual(6);
    expect(candidates.every((c) => c.symbol && c.screen && c.reason)).toBe(true);
  });
});

describe("buildUniverse", () => {
  test("dedupes held ∪ watchlist ∪ scan and caps scan", () => {
    const u = buildUniverse({
      held: ["AAPL", "NVDA"],
      watchlist: ["NVDA", "MSFT"],
      scan: [{ symbol: "AAPL", screen: "momentum", reason: "x" }, { symbol: "TSLA", screen: "value", reason: "y" }],
    });
    expect(u.symbols.sort()).toEqual(["AAPL", "MSFT", "NVDA", "TSLA"]);
    expect(u.bySymbol.get("AAPL")?.source).toBe("held"); // held wins over scan
    expect(u.bySymbol.get("TSLA")?.source).toBe("scan");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test src/analysis/universe.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement the scan**

Create `src/analysis/opportunityScan.ts`:

```ts
import type { MarketData } from "../market/types.ts";
import type { FundamentalsSource } from "../fundamentals/types.ts";
import { type ScanCandidate } from "../domain/scan.ts";

/** Blend momentum (Alpaca movers) with fundamental screens (FMP), capped to `limit` total. */
export async function runOpportunityScan(
  market: MarketData,
  fundamentals: FundamentalsSource,
  limit: number,
): Promise<ScanCandidate[]> {
  if (limit <= 0) return [];
  const per = Math.max(1, Math.ceil(limit / 3));
  const [movers, value, quality] = await Promise.all([
    market.getMovers(per).catch(() => []),
    fundamentals.screen({ peLowerThan: 20, marketCapMoreThan: 2e9, limit: per }).catch(() => []),
    fundamentals.screen({ roeMoreThan: 15, marketCapMoreThan: 2e9, limit: per }).catch(() => []),
  ]);
  const out: ScanCandidate[] = [];
  for (const m of movers) out.push({ symbol: m.symbol, screen: "momentum", reason: `most active, vol ${m.volume.toLocaleString()}` });
  for (const s of value) out.push({ symbol: s, screen: "value", reason: "low P/E, mid+ cap" });
  for (const s of quality) out.push({ symbol: s, screen: "quality_growth", reason: "ROE > 15%" });
  // dedupe by symbol, keep first occurrence, cap
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true))).slice(0, limit);
}
```

- [ ] **Step 5: Implement the universe builder**

Create `src/analysis/universe.ts`:

```ts
import type { ScanCandidate } from "../domain/scan.ts";

export type UniverseSource = "held" | "watchlist" | "scan";
export type UniverseEntry = { symbol: string; source: UniverseSource; candidate?: ScanCandidate };
export type Universe = { symbols: string[]; bySymbol: Map<string, UniverseEntry> };

/** Merge held ∪ watchlist ∪ scan with precedence held > watchlist > scan; dedupe by symbol. */
export function buildUniverse(input: {
  held: string[];
  watchlist: string[];
  scan: ScanCandidate[];
}): Universe {
  const bySymbol = new Map<string, UniverseEntry>();
  for (const c of input.scan) if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, { symbol: c.symbol, source: "scan", candidate: c });
  for (const s of input.watchlist) bySymbol.set(s, { symbol: s, source: "watchlist" });
  for (const s of input.held) bySymbol.set(s, { symbol: s, source: "held" });
  return { symbols: [...bySymbol.keys()], bySymbol };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/analysis/universe.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/scan.ts src/domain/index.ts src/analysis/opportunityScan.ts src/analysis/universe.ts src/analysis/universe.test.ts
git commit -m "feat(analysis): opportunity scan + universe builder"
```

---

## Task 6: LLM layer — schema, prompts, analyzer (mock first), Gemini spike

**Files:**
- Create: `src/domain/marketContext.ts`, `src/llm/schema.ts`, `src/llm/prompts.ts`, `src/llm/analyze.ts`, `src/llm/gemini.ts`, `scripts/gemini-smoke.ts`, `scripts/fmp-smoke.ts`
- Modify: `src/domain/index.ts`, `src/domain/recommendation.ts` (enrich), `package.json` (scripts)
- Test: `src/llm/llm.test.ts`

- [ ] **Step 1: SPIKE — confirm the Gemini contract before building**

Create `scripts/gemini-smoke.ts`:

```ts
/** Spike: confirm gemini-3.1-pro-preview can ground via Google Search AND return a structured
 *  function-tool call with citations, in one request. Run: bun run gemini:smoke */
import { GoogleGenAI } from "@google/genai";
import { loadEnv } from "../src/config/env.ts";

const env = loadEnv();
if (!env.GEMINI_API_KEY) { console.error("Set GEMINI_API_KEY in .env"); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const submitRecommendation = {
  name: "submit_recommendation",
  description: "Return the structured recommendation for the ticker.",
  parameters: {
    type: "object",
    properties: {
      ticker: { type: "string" },
      action: { type: "string", enum: ["BUY", "SELL", "HOLD", "WATCH"] },
      conviction: { type: "number" },
      thesis: { type: "string" },
    },
    required: ["ticker", "action", "conviction", "thesis"],
  },
};

const res = await ai.models.generateContent({
  model: env.GEMINI_MODEL,
  contents: "Research the latest news on NVDA today, then call submit_recommendation with your call.",
  config: {
    tools: [{ googleSearch: {} }, { functionDeclarations: [submitRecommendation] }],
    thinkingConfig: { thinkingLevel: env.GEMINI_THINKING_LEVEL.toUpperCase() },
  },
});

console.log("functionCalls:", JSON.stringify(res.functionCalls, null, 2));
console.log("text:", res.text);
const gm = res.candidates?.[0]?.groundingMetadata;
console.log("grounding chunks:", gm?.groundingChunks?.length ?? 0);
```

- [ ] **Step 2: Run the spike with your real key**

Run: `bun run scripts/gemini-smoke.ts` (add `"gemini:smoke": "bun run scripts/gemini-smoke.ts"` to package.json scripts first)
Expected: prints a `submit_recommendation` function call with args AND non-zero grounding chunks.

**Decision gate:** If `functionCalls` is populated alongside grounding → proceed with the single-call design (Step 6). If the model returns text instead of a call when both tools are present, switch `gemini.ts` to the **two-stage fallback**: (a) grounded call (googleSearch only) → text; (b) second call with only the function tool over that text. Record which path worked in a comment at the top of `src/llm/gemini.ts`.

- [ ] **Step 3: FMP smoke script**

Create `scripts/fmp-smoke.ts`:

```ts
/** Confirm FMP credentials + inspect which fields your plan returns. Run: bun run fmp:smoke */
import { loadEnv } from "../src/config/env.ts";
import { createFmpFundamentals } from "../src/fundamentals/fmp/index.ts";

const env = loadEnv();
if (!env.FMP_API_KEY) { console.error("Set FMP_API_KEY in .env"); process.exit(1); }
const f = createFmpFundamentals(env);
console.log(JSON.stringify(await f.get("AAPL"), null, 2));
console.log("value screen:", await f.screen({ peLowerThan: 20, marketCapMoreThan: 2e9, limit: 5 }));
```

Add to package.json scripts: `"fmp:smoke": "bun run scripts/fmp-smoke.ts"`. Run `bun run fmp:smoke`; note any null fields (premium-gated) — they stay null by design.

- [ ] **Step 4: MarketContext schema + enrich Recommendation**

Create `src/domain/marketContext.ts`:

```ts
import { z } from "zod";
export const Source = z.object({ title: z.string(), url: z.string() });
export type Source = z.infer<typeof Source>;
export const MarketContext = z.object({
  date: z.string(),
  spyTrend: z.enum(["up", "down", "sideways"]).nullable().default(null),
  spyPctFromSma200: z.number().nullable().default(null),
  macroSummary: z.string().default(""),
  sources: z.array(Source).default([]),
});
export type MarketContext = z.infer<typeof MarketContext>;
```

In `src/domain/recommendation.ts`, add these imports at the top:

```ts
import { Fundamentals } from "./fundamentals.ts";
import { MarketContext, Source } from "./marketContext.ts";
```

Add these fields to the `Recommendation` object (after `technicals`):

```ts
  fundamentals: Fundamentals.nullable().default(null),
  priceTargetUpside: z.number().nullable().default(null),
  sources: z.array(Source).default([]),
  screen: z.string().nullable().default(null),
```

Add this field to the `DailyReport` object:

```ts
  marketContext: MarketContext.nullable().default(null),
```

Add `export * from "./marketContext.ts";` to `src/domain/index.ts`.

- [ ] **Step 5: Recommendation → Gemini function declaration**

Create `src/llm/schema.ts`:

```ts
/** The function declaration Gemini calls to return a structured recommendation. Kept in sync with
 *  the Recommendation Zod schema; output is re-validated with Zod after the call. */
export const recommendationFunctionDeclaration = {
  name: "submit_recommendation",
  description: "Return the final structured recommendation for one ticker.",
  parameters: {
    type: "object",
    properties: {
      ticker: { type: "string" },
      action: { type: "string", enum: ["BUY", "SELL", "HOLD", "WATCH"] },
      conviction: { type: "number", description: "0..1" },
      horizon: { type: "string", enum: ["30m", "1d", "5d", "30d"] },
      strategyFamily: { type: "string" },
      thesis: { type: "string" },
      signals: { type: "array", items: { type: "string" } },
      catalyst: {
        type: "object",
        nullable: true,
        properties: { kind: { type: "string" }, summary: { type: "string" }, sentiment: { type: "number" } },
      },
      tradePlan: {
        type: "object",
        nullable: true,
        properties: {
          entry: { type: "number" }, stop: { type: "number" }, target: { type: "number" },
          rMultiple: { type: "number" }, invalidation: { type: "string" },
        },
      },
      watchTrigger: { type: "string", nullable: true },
    },
    required: ["ticker", "action", "conviction", "horizon", "strategyFamily", "thesis", "signals"],
  },
} as const;
```

- [ ] **Step 6: Prompt builders**

Create `src/llm/prompts.ts`:

```ts
import type { Fundamentals, MarketContext, Technicals } from "../domain/index.ts";

export type TickerInput = {
  symbol: string;
  source: "held" | "watchlist" | "scan";
  screenReason?: string;
  price: number;
  technicals: Technicals;
  fundamentals: Fundamentals;
  riskPreset: string;
};

export function buildTickerPrompt(t: TickerInput, ctx: MarketContext): string {
  return [
    `You are an equity analyst. Analyze ${t.symbol} and return ONE recommendation via the`,
    `submit_recommendation function. Use Google Search to verify recent catalysts/news and cite them.`,
    `Base any numeric facts ONLY on the provided data; do not invent figures.`,
    ``,
    `Market context (${ctx.date}): SPY trend ${ctx.spyTrend ?? "unknown"}; ${ctx.macroSummary}`,
    `Risk profile: ${t.riskPreset}. Candidate source: ${t.source}${t.screenReason ? ` (${t.screenReason})` : ""}.`,
    ``,
    `Technicals: ${JSON.stringify(t.technicals)}`,
    `Fundamentals: ${JSON.stringify(t.fundamentals)}`,
    `Latest price: ${t.price}.`,
    ``,
    `Decide BUY / SELL / HOLD / WATCH with a concise thesis, conviction (0..1), horizon, a strategy`,
    `family, the signals you used, an optional catalyst (with sentiment), and an optional trade plan`,
    `(entry/stop/target/rMultiple/invalidation). For WATCH, give the trigger to promote to BUY.`,
  ].join("\n");
}

export function buildMarketContextPrompt(date: string, spyTrend: string, spyPctFromSma200: number | null): string {
  return [
    `Summarize today's (${date}) US equity market regime in 2-3 sentences for a trader.`,
    `SPY trend is ${spyTrend}${spyPctFromSma200 != null ? ` (${spyPctFromSma200.toFixed(1)}% vs its 200-day SMA)` : ""}.`,
    `Use Google Search for VIX level, rates, and notable macro catalysts. Cite sources.`,
  ].join("\n");
}
```

- [ ] **Step 7: Analyzer interface + mock + failing test**

Create `src/llm/analyze.ts`:

```ts
import type { Recommendation } from "../domain/index.ts";
import type { MarketContext } from "../domain/marketContext.ts";
import type { TickerInput } from "./prompts.ts";

export interface Analyzer {
  readonly kind: "gemini" | "mock";
  analyzeTicker(input: TickerInput, ctx: MarketContext): Promise<Recommendation>;
  marketMacro(date: string, spyTrend: string, spyPctFromSma200: number | null): Promise<{ summary: string; sources: { title: string; url: string }[] }>;
}

/** Deterministic offline analyzer for tests — never calls the network. */
export function createMockAnalyzer(): Analyzer {
  return {
    kind: "mock",
    async analyzeTicker(input): Promise<Recommendation> {
      return {
        ticker: input.symbol, action: "HOLD", conviction: 0.5, horizon: "5d",
        strategyFamily: "trend", thesis: `mock thesis for ${input.symbol}`, signals: ["mock"],
        technicals: input.technicals, catalyst: null, tradePlan: null, briefingNote: null,
        watchTrigger: null, fundamentals: input.fundamentals,
        priceTargetUpside: null, sources: [], screen: input.source === "scan" ? "momentum" : null,
      };
    },
    async marketMacro() { return { summary: "mock macro", sources: [] }; },
  };
}
```

Create `src/llm/llm.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createMockAnalyzer } from "./analyze.ts";
import { Recommendation, emptyTechnicals, emptyFundamentals, MarketContext } from "../domain/index.ts";

describe("mock analyzer", () => {
  test("returns a schema-valid recommendation", async () => {
    const a = createMockAnalyzer();
    const rec = await a.analyzeTicker(
      { symbol: "AAPL", source: "held", price: 200, technicals: emptyTechnicals(), fundamentals: emptyFundamentals("AAPL"), riskPreset: "balanced" },
      MarketContext.parse({ date: "2026-06-01" }),
    );
    expect(() => Recommendation.parse(rec)).not.toThrow();
    expect(rec.ticker).toBe("AAPL");
  });
});
```

- [ ] **Step 8: Run to verify failure, then it should pass once modules exist**

Run: `bun test src/llm/`
Expected: FAIL first (missing exports), then PASS after Steps 4–7 compile. Run `bunx tsc --noEmit` and fix import paths until clean.

- [ ] **Step 9: Real Gemini analyzer**

Create `src/llm/gemini.ts` (use the path confirmed by the Step 2 spike; this is the single-call version):

```ts
import { GoogleGenAI } from "@google/genai";
import type { Env } from "../config/env.ts";
import { Recommendation } from "../domain/index.ts";
import type { MarketContext } from "../domain/marketContext.ts";
import type { Analyzer } from "./analyze.ts";
import { buildMarketContextPrompt, buildTickerPrompt, type TickerInput } from "./prompts.ts";
import { recommendationFunctionDeclaration } from "./schema.ts";

export function createGeminiAnalyzer(env: Env): Analyzer {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const baseConfig = {
    tools: [{ googleSearch: {} }, { functionDeclarations: [recommendationFunctionDeclaration] }],
    thinkingConfig: { thinkingLevel: env.GEMINI_THINKING_LEVEL.toUpperCase() },
  };

  function citations(res: any): { title: string; url: string }[] {
    const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    return chunks.map((c: any) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" })).filter((s: any) => s.url);
  }

  return {
    kind: "gemini",
    async analyzeTicker(input: TickerInput, ctx: MarketContext): Promise<Recommendation> {
      const res = await ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: buildTickerPrompt(input, ctx),
        config: baseConfig,
      });
      const call = res.functionCalls?.find((c: any) => c.name === "submit_recommendation");
      if (!call) throw new Error(`No recommendation call for ${input.symbol}`);
      const upside =
        input.fundamentals.priceTargetMean && input.price
          ? Math.round(((input.fundamentals.priceTargetMean - input.price) / input.price) * 10000) / 100
          : null;
      return Recommendation.parse({
        ...call.args,
        ticker: input.symbol,
        technicals: input.technicals,
        fundamentals: input.fundamentals,
        priceTargetUpside: upside,
        sources: citations(res),
        screen: input.screenReason ? input.source : null,
      });
    },
    async marketMacro(date, spyTrend, spyPctFromSma200) {
      const res = await ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: buildMarketContextPrompt(date, spyTrend, spyPctFromSma200),
        config: { tools: [{ googleSearch: {} }], thinkingConfig: { thinkingLevel: "LOW" } },
      });
      return { summary: res.text ?? "", sources: citations(res) };
    },
  };
}
```

- [ ] **Step 10: Run tests + typecheck + commit**

Run: `bun test src/llm/ && bunx tsc --noEmit`
Expected: PASS / clean.

```bash
git add src/domain/marketContext.ts src/domain/recommendation.ts src/domain/index.ts src/llm/ scripts/gemini-smoke.ts scripts/fmp-smoke.ts package.json
git commit -m "feat(llm): Gemini analyzer + mock + grounded function-tool schema"
```

---

## Task 7: Market context builder

**Files:**
- Create: `src/analysis/marketContext.ts`
- Test: `src/analysis/marketContext.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/analysis/marketContext.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createFakeGateway } from "../market/index.ts";
import { createMockAnalyzer } from "../llm/analyze.ts";
import { buildMarketContext } from "./marketContext.ts";
import { MarketContext } from "../domain/index.ts";

test("builds a schema-valid market context from SPY bars + analyzer", async () => {
  const gw = createFakeGateway({ now: () => "2026-06-01" });
  const ctx = await buildMarketContext(gw, createMockAnalyzer(), "2026-06-01");
  expect(() => MarketContext.parse(ctx)).not.toThrow();
  expect(["up", "down", "sideways", null]).toContain(ctx.spyTrend);
  expect(ctx.macroSummary).toBe("mock macro");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/analysis/marketContext.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `src/analysis/marketContext.ts`:

```ts
import type { MarketData } from "../market/types.ts";
import type { Analyzer } from "../llm/analyze.ts";
import { MarketContext } from "../domain/marketContext.ts";
import { computeTechnicals } from "./technicals.ts";

export async function buildMarketContext(
  market: MarketData,
  analyzer: Analyzer,
  date: string,
): Promise<MarketContext> {
  const bars = await market.getBars("SPY", 250).catch(() => []);
  const t = computeTechnicals(bars, null);
  const pct = t.priceVsSma200Pct;
  const spyTrend = pct == null ? null : pct > 1 ? "up" : pct < -1 ? "down" : "sideways";
  const macro = await analyzer
    .marketMacro(date, spyTrend ?? "unknown", pct)
    .catch(() => ({ summary: "", sources: [] }));
  return MarketContext.parse({
    date, spyTrend, spyPctFromSma200: pct, macroSummary: macro.summary, sources: macro.sources,
  });
}
```

- [ ] **Step 4: Run to verify pass + commit**

Run: `bun test src/analysis/marketContext.test.ts`
Expected: PASS.

```bash
git add src/analysis/marketContext.ts src/analysis/marketContext.test.ts
git commit -m "feat(analysis): market context builder"
```

---

## Task 8: Watchlist (domain, repo, routes)

**Files:**
- Create: `src/domain/watchlist.ts`, `src/db/repositories/watchlist.ts`, `src/server/routes/watchlist.ts`
- Modify: `src/domain/index.ts`, `src/db/index.ts`, `src/server/app.ts`
- Test: `src/server/server.test.ts` (add cases)

- [ ] **Step 1: Watchlist schema**

Create `src/domain/watchlist.ts`:

```ts
import { z } from "zod";
import { Symbol } from "./holding.ts";
export const WatchlistItem = z.object({
  id: z.string().min(1),
  symbol: Symbol,
  note: z.string().nullable().default(null),
});
export type WatchlistItem = z.infer<typeof WatchlistItem>;
export const WatchlistInput = z.object({ symbol: Symbol, note: z.string().nullable().optional() });
export type WatchlistInput = z.infer<typeof WatchlistInput>;
```

Add `export * from "./watchlist.ts";` to `src/domain/index.ts`.

- [ ] **Step 2: Watchlist repo**

Create `src/db/repositories/watchlist.ts`:

```ts
import type { DB } from "../connection.ts";
import { WatchlistInput, WatchlistItem, newId } from "../../domain/index.ts";

type Row = { id: string; symbol: string; note: string | null };
const toDomain = (r: Row): WatchlistItem => WatchlistItem.parse({ id: r.id, symbol: r.symbol, note: r.note });

export function watchlistRepo(db: DB) {
  return {
    list(): WatchlistItem[] {
      return db.query<Row, []>("SELECT * FROM watchlist ORDER BY symbol").all().map(toDomain);
    },
    add(input: WatchlistInput): WatchlistItem {
      const valid = WatchlistInput.parse(input);
      db.query(
        `INSERT INTO watchlist (id, symbol, note) VALUES (?, ?, ?)
         ON CONFLICT (symbol) DO UPDATE SET note = excluded.note`,
      ).run(newId(), valid.symbol, valid.note ?? null);
      return toDomain(db.query<Row, [string]>("SELECT * FROM watchlist WHERE symbol = ?").get(valid.symbol)!);
    },
    remove(id: string): boolean {
      return db.query("DELETE FROM watchlist WHERE id = ?").run(id).changes > 0;
    },
  };
}
export type WatchlistRepo = ReturnType<typeof watchlistRepo>;
```

Wire into `src/db/index.ts`: import and add `watchlist: watchlistRepo(db),` to the `repositories()` return.

- [ ] **Step 3: Routes**

Create `src/server/routes/watchlist.ts`:

```ts
import { Hono } from "hono";
import type { App } from "../../app.ts";
import { WatchlistInput } from "../../domain/index.ts";

export function watchlistRoutes(app: App): Hono {
  const r = new Hono();
  r.get("/", (c) => c.json(app.repos.watchlist.list()));
  r.post("/", async (c) => {
    const parsed = WatchlistInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    return c.json(app.repos.watchlist.add(parsed.data), 201);
  });
  r.delete("/:id", (c) => {
    const ok = app.repos.watchlist.remove(c.req.param("id"));
    return c.json({ ok }, ok ? 200 : 404);
  });
  return r;
}
```

Mount in `src/server/app.ts`: import `watchlistRoutes` and add `api.route("/watchlist", watchlistRoutes(app));`.

- [ ] **Step 4: Write failing tests**

Add to `src/server/server.test.ts`:

```ts
describe("watchlist", () => {
  test("add, list, delete", async () => {
    const add = await req("/api/watchlist", {
      method: "POST", body: JSON.stringify({ symbol: "tsla" }), headers: { "Content-Type": "application/json" },
    });
    expect(add.status).toBe(201);
    const created = (await add.json()) as { id: string; symbol: string };
    expect(created.symbol).toBe("TSLA");
    expect(((await (await req("/api/watchlist")).json()) as unknown[]).length).toBe(1);
    const del = await req(`/api/watchlist/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });
});
```

- [ ] **Step 5: Run tests + commit**

Run: `bun test src/server/`
Expected: PASS.

```bash
git add src/domain/watchlist.ts src/domain/index.ts src/db/repositories/watchlist.ts src/db/index.ts src/server/routes/watchlist.ts src/server/app.ts src/server/server.test.ts
git commit -m "feat(watchlist): domain, repo, routes"
```

---

## Task 9: Wire analyzer + fundamentals into App, swap the pipeline step

**Files:**
- Modify: `src/app.ts`, `src/pipeline/dailyRun.ts`
- Create: `src/pipeline/llmReport.ts`
- Test: `src/pipeline/llmReport.test.ts`

- [ ] **Step 1: Extend App with analyzer + fundamentals**

In `src/app.ts`, add to the `App` type:

```ts
  analyzer: import("./llm/analyze.ts").Analyzer | null;
  fundamentals: import("./fundamentals/index.ts").FundamentalsSource;
```

In `CreateAppOptions` add optional `analyzer?` and `fundamentals?`. In `createApp`, after building `gateway`, add:

```ts
  const fundamentals =
    opts.fundamentals ?? cached(createFundamentals(env), repos, opts.now ?? (() => today()));
  const analyzer =
    opts.analyzer ?? (env.GEMINI_API_KEY ? createGeminiAnalyzer(env) : null);
```

Add imports at the top: `import { cached, createFundamentals } from "./fundamentals/index.ts";` and `import { createGeminiAnalyzer } from "./llm/gemini.ts";`. Return `analyzer` and `fundamentals` in the `App` object.

- [ ] **Step 2: Write failing test for generateLlmReport**

Create `src/pipeline/llmReport.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createFakeFundamentals } from "../fundamentals/index.ts";
import { createMockAnalyzer } from "../llm/analyze.ts";
import { generateLlmReport } from "./llmReport.ts";
import { DailyReport } from "../domain/index.ts";

const DATE = "2026-06-01";
function makeApp(analyzer = createMockAnalyzer()): App {
  return createApp({
    db: openMemoryDb(),
    gateway: createFakeGateway({ now: () => DATE }),
    fundamentals: createFakeFundamentals(),
    analyzer,
    now: () => DATE,
  });
}

describe("generateLlmReport", () => {
  test("analyzes held + watchlist + scan into a schema-valid report", async () => {
    const app = makeApp();
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 5 });
    app.repos.watchlist.add({ symbol: "MSFT" });
    const report = await generateLlmReport(app);
    expect(() => DailyReport.parse(report)).not.toThrow();
    expect(report.source).toBe("llm");
    const tickers = report.recommendations.map((r) => r.ticker);
    expect(tickers).toContain("AAPL");
    expect(tickers).toContain("MSFT");
    expect(report.marketContext).not.toBeNull();
  });

  test("one failing ticker is skipped, not fatal", async () => {
    const flaky = createMockAnalyzer();
    const orig = flaky.analyzeTicker.bind(flaky);
    flaky.analyzeTicker = async (input, ctx) => {
      if (input.symbol === "AAPL") throw new Error("boom");
      return orig(input, ctx);
    };
    const app = makeApp(flaky);
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 5 });
    app.repos.watchlist.add({ symbol: "MSFT" });
    const report = await generateLlmReport(app);
    const tickers = report.recommendations.map((r) => r.ticker);
    expect(tickers).not.toContain("AAPL");
    expect(tickers).toContain("MSFT");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test src/pipeline/llmReport.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 4: Implement generateLlmReport**

Create `src/pipeline/llmReport.ts`:

```ts
import type { App } from "../app.ts";
import { newId, type DailyReport, type Recommendation } from "../domain/index.ts";
import { computeTechnicals } from "../analysis/technicals.ts";
import { buildMarketContext } from "../analysis/marketContext.ts";
import { runOpportunityScan } from "../analysis/opportunityScan.ts";
import { buildUniverse, type UniverseEntry } from "../analysis/universe.ts";

const LOOKBACK = 252;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Real per-ticker analysis. Requires app.analyzer (else the caller falls back to the fake report). */
export async function generateLlmReport(app: App): Promise<DailyReport> {
  const analyzer = app.analyzer!;
  const date = app.now();
  const riskPreset = app.repos.risk.get(app.user.id)?.preset ?? "balanced";

  const ctx = await buildMarketContext(app.gateway, analyzer, date);

  const held = app.repos.holdings.listByPortfolio(app.user.id).map((h) => h.symbol);
  const watchlist = app.repos.watchlist.list().map((w) => w.symbol);
  const scan = await runOpportunityScan(app.gateway, app.fundamentals, app.env.MAX_SCAN_CANDIDATES).catch(() => []);
  const universe = buildUniverse({ held, watchlist, scan });

  const results = await mapLimit(universe.symbols, app.env.LLM_CONCURRENCY, async (symbol) => {
    const entry = universe.bySymbol.get(symbol) as UniverseEntry;
    try {
      const [bars, quote, fundamentals] = await Promise.all([
        app.gateway.getBars(symbol, LOOKBACK),
        app.gateway.getQuote(symbol),
        app.fundamentals.get(symbol),
      ]);
      const technicals = computeTechnicals(bars, null); // beta wired from FMP profile in a later pass
      const rec = await analyzer.analyzeTicker(
        {
          symbol, source: entry.source, screenReason: entry.candidate?.reason,
          price: quote.price, technicals, fundamentals, riskPreset,
        },
        ctx,
      );
      return rec;
    } catch (err) {
      console.error(`analyze ${symbol} failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  });

  const recommendations = results.filter((r): r is Recommendation => r !== null);
  return { id: newId(), date, generatedAt: new Date().toISOString(), source: "llm", recommendations, marketContext: ctx };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `bun test src/pipeline/llmReport.test.ts`
Expected: PASS.

- [ ] **Step 6: Swap the step in dailyRun (with fake fallback)**

In `src/pipeline/dailyRun.ts`, replace the Step 3 block:

```ts
    // Step 3 — analysis: real LLM report when an analyzer is configured, else fake fallback.
    const report = app.analyzer
      ? await generateLlmReport(app)
      : generateFakeReport(user.positions.map((p) => p.symbol), date);
```

Add the import: `import { generateLlmReport } from "./llmReport.ts";`. Keep the existing `generateFakeReport` import.

- [ ] **Step 7: Run the full pipeline + server suites**

Run: `bun test src/pipeline/ src/server/ && bunx tsc --noEmit`
Expected: PASS / clean. (Existing pipeline tests build apps without an analyzer → fake fallback path still works; `createApp` defaults `analyzer` to null when `GEMINI_API_KEY` is empty, which it is in tests.)

- [ ] **Step 8: Commit**

```bash
git add src/app.ts src/pipeline/llmReport.ts src/pipeline/dailyRun.ts src/pipeline/llmReport.test.ts
git commit -m "feat(pipeline): real LLM report with fake fallback + bounded concurrency"
```

---

## Task 10: UI — market-context banner, richer card, watchlist, analyzing state

**Files (read current versions first — the frontend uses a custom design system):**
- Read: `web/src/components/RecommendationCard.tsx`, `web/src/components/TickerManager.tsx`, `web/src/components/Recommendations.tsx`, `web/src/components/ui/*`, `web/src/api/types.ts`, `web/src/api/hooks.ts`
- Create: `web/src/components/MarketContextBanner.tsx`
- Modify: `web/src/components/RecommendationCard.tsx`, `web/src/components/TickerManager.tsx`, `web/src/components/Recommendations.tsx`, `web/src/api/client.ts`, `web/src/api/hooks.ts`

- [ ] **Step 1: Add watchlist API client + hooks**

In `web/src/api/client.ts`, add to the `client` object:

```ts
  watchlist: () => api<{ id: string; symbol: string; note: string | null }[]>("/watchlist"),
  addWatch: (symbol: string) => api<{ id: string }>("/watchlist", { method: "POST", body: JSON.stringify({ symbol }) }),
  removeWatch: (id: string) => api<{ ok: boolean }>(`/watchlist/${id}`, { method: "DELETE" }),
```

In `web/src/api/hooks.ts`, add a `watchlist` key, `useWatchlist`, `useAddWatch`, `useRemoveWatch` mirroring the existing holdings hooks (same `useInvalidateAll` pattern).

- [ ] **Step 2: Market context banner**

Create `web/src/components/MarketContextBanner.tsx` using the existing `Card`/`Badge` components:

```tsx
import type { DailyReport } from "../api/types.ts";

export function MarketContextBanner({ report }: { report: DailyReport | null }) {
  const ctx = report?.marketContext;
  if (!ctx) return null;
  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <span className="eyebrow">Market context</span>
        {ctx.spyTrend && (
          <span className="rounded-md border border-hairline px-2 py-0.5 text-[11px] capitalize text-text-secondary">
            SPY {ctx.spyTrend}
          </span>
        )}
      </div>
      <p className="text-sm text-text-secondary">{ctx.macroSummary || "No macro summary."}</p>
      {ctx.sources.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {ctx.sources.slice(0, 4).map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">
              {s.title || new URL(s.url).hostname}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

Render it in `web/src/App.tsx` at the top of the "Daily recommendations" section (above `<Recommendations />`).

- [ ] **Step 3: Enrich the recommendation card**

Read `web/src/components/RecommendationCard.tsx`, then add (matching its existing styling) a fundamentals strip and citations below the trade plan. Insert this block before the closing tag:

```tsx
{r.fundamentals && (
  <div className="mt-2 grid grid-cols-4 gap-2 border-t border-hairline pt-2 text-[11px] text-text-secondary">
    <div><div className="text-text-muted">P/E</div>{r.fundamentals.peTrailing?.toFixed(1) ?? "—"}</div>
    <div><div className="text-text-muted">Rev YoY</div>{r.fundamentals.revenueGrowthYoY != null ? `${r.fundamentals.revenueGrowthYoY.toFixed(0)}%` : "—"}</div>
    <div><div className="text-text-muted">Net mgn</div>{r.fundamentals.netMargin != null ? `${r.fundamentals.netMargin.toFixed(0)}%` : "—"}</div>
    <div><div className="text-text-muted">Tgt up</div>{r.priceTargetUpside != null ? `${r.priceTargetUpside.toFixed(0)}%` : "—"}</div>
  </div>
)}
{r.sources && r.sources.length > 0 && (
  <div className="mt-2 flex flex-wrap gap-2 border-t border-hairline pt-2">
    {r.sources.slice(0, 3).map((s) => (
      <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-[10px] text-accent hover:underline">
        {s.title || new URL(s.url).hostname}
      </a>
    ))}
  </div>
)}
```

(If `web/src/api/types.ts` re-exports domain types, `fundamentals`/`sources`/`priceTargetUpside` are already on `Recommendation` — no client type changes needed.)

- [ ] **Step 4: Watchlist section in the ticker manager**

Read `web/src/components/TickerManager.tsx`. Add a second section below the holdings table titled "Watchlist" using `useWatchlist`/`useAddWatch`/`useRemoveWatch`: an input + Add button and a list of chips with a remove (×) each. Mirror the holdings add-row pattern already in the file.

- [ ] **Step 5: "Analyzing" state**

The Run button already shows a loading state via `useRunNow().isPending`. Update its label so when running it reads "Analyzing…" (LLM runs are slower). In `web/src/components/Header.tsx`, change the running label from "Running" to "Analyzing".

- [ ] **Step 6: Build + dogfood**

Run: `bun run build:web` (expect success). Then start a **fake-adapter** dev server to dogfood without touching your paper account:

```bash
MARKET_ADAPTER=fake DATABASE_PATH=./data/dogfood.sqlite bun run dev
```

Open http://localhost:5173, add a watchlist symbol, Run analysis, verify the market-context banner, fundamentals strip, and citations render. (With no GEMINI key in that shell, you get the fake report — to see real output, run with your real `.env`.)

- [ ] **Step 7: Commit**

```bash
git add web/
git commit -m "feat(web): market-context banner, fundamentals + citations on cards, watchlist UI"
```

---

## Task 11: E2E update + full verification

**Files:**
- Modify: `e2e/dashboard.spec.ts`
- Test: full suite

- [ ] **Step 1: Add a watchlist E2E case**

Add to `e2e/dashboard.spec.ts` (it runs against the fake adapter per Task 1):

```ts
test("add and remove a watchlist symbol", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByPlaceholder("Add to watchlist").fill("TSLA");
  await page.getByRole("button", { name: "Watch" }).click();
  await expect(page.getByText("TSLA").first()).toBeVisible();
});
```

(Adjust the placeholder/button text to match what you built in Task 10 Step 4.)

- [ ] **Step 2: Run the whole backend suite**

Run: `bun test`
Expected: all PASS (target 80%+ coverage on new modules).

- [ ] **Step 3: Run E2E (fake adapter, isolated db)**

Run: `bun run test:e2e`
Expected: all PASS. Confirm your real Alpaca paper account was untouched (E2E used `MARKET_ADAPTER=fake`).

- [ ] **Step 4: Live smoke with real keys**

Run: `bun run gemini:smoke` and `bun run fmp:smoke` → both succeed. Then with your real `.env` (`MARKET_ADAPTER=alpaca`, real keys):

```bash
bun run dev
```

Add a couple of holdings + a watchlist symbol → Run analysis → confirm: real recommendations with grounded catalysts + citations, fundamentals populated, market-context banner filled, snapshots written, no run error.

- [ ] **Step 5: Update README + commit**

Add the FMP + Gemini setup steps to `README.md` (where the Alpaca walkthrough is) and document `bun run gemini:smoke` / `bun run fmp:smoke`.

```bash
git add e2e/dashboard.spec.ts README.md
git commit -m "test(e2e): watchlist flow; docs: Phase 2 setup"
```

---

## Self-review notes

- **Spec coverage:** technicals (Task 3), fundamentals + FMP + cache (Task 4), opportunity scan + universe (Task 5), LLM grounded analysis + schema + spike (Task 6), market context (Task 7), watchlist (Task 8), pipeline swap + fake fallback + resilience (Task 9), UI: banner/card/watchlist/analyzing (Task 10), config + E2E safety (Task 1), market data history+movers (Task 2), live verification (Task 11). All spec sections map to a task.
- **Type consistency:** `Analyzer.analyzeTicker(TickerInput, MarketContext)`, `FundamentalsSource.get/screen`, `MarketData.getBars(symbol, days)/getMovers(limit)`, `buildUniverse({held,watchlist,scan})→{symbols,bySymbol}`, `computeTechnicals(bars, beta)→Technicals` are used consistently across tasks.
- **Known uncertainty (handled, not a placeholder):** the exact `@google/genai` config shape for `thinkingLevel` and the grounding+function-tool single-call behavior on `gemini-3.1-pro-preview` are confirmed by the Task 6 Step 1–2 spike before `gemini.ts` is finalized; two-stage fallback documented. FMP field names confirmed by `fmp:smoke`; unknown fields stay null by design.

---

## Addendum A — Sentiment / thematic opportunity discovery (user-requested)

The opportunity scan must do more than quantitative screening. In addition to Task 5's movers + FMP
fundamental screens, add an **LLM-grounded sentiment/thematic discovery** pass that scouts the wider
market for breakthrough, high-potential opportunities — the kind credible professionals are pointing
at — and folds them into the universe as additional candidates. It runs on Gemini 3.1 Pro + Google
Search grounding (no new API key); a dedicated social API can be added later if deeper real-time
social data is wanted.

**What it surfaces (credibility-filtered, research not advice):**
- Sentiment from credible sources: reputable analysts/investors, high-signal Reddit/X discussion,
  reputable financial press — aggregated, with the source cited.
- Where trusted professionals are scouting opportunity; conviction from named, reputable voices over
  anonymous hype.
- High-potential industries and the direction technology / markets / the economy are heading
  (secular themes: AI infra, energy transition, biotech breakthroughs, etc.).

**Design changes (implement in Task 6, wire in Task 9):**

1. **`ScreenType` (extend `src/domain/scan.ts`)** — add `"sentiment"` and `"thematic"` to the enum
   (now: `momentum | mean_reversion | value | quality_growth | catalyst | sentiment | thematic`).
   Add an optional `sources` field to `ScanCandidate`:
   ```ts
   import { Source } from "./marketContext.ts"; // {title,url}
   export const ScanCandidate = z.object({
     symbol: z.string(),
     screen: ScreenType,
     reason: z.string(),
     sources: z.array(Source).default([]),
   });
   ```

2. **`Analyzer` interface (extend in `src/llm/analyze.ts`)** — add:
   ```ts
   discoverOpportunities(ctx: MarketContext, count: number): Promise<ScanCandidate[]>;
   ```
   - **Mock** returns a deterministic list (e.g. 2 candidates tagged `thematic`/`sentiment` with a
     reason and empty `sources`), so pipeline tests stay offline + deterministic.
   - **Gemini** implementation: one grounded `generateContent` call (Search enabled) using a
     `submit_candidates` function-tool whose params are `{ candidates: [{ symbol, screen, reason }] }`.
     Extract args + grounding citations → attach `sources` to each candidate. Validate each through
     `ScanCandidate`. On failure return `[]` (never fatal).

3. **Discovery prompt (`src/llm/prompts.ts`, `buildDiscoveryPrompt(ctx, count)`)** — instruct the
   model to: use Google Search to find up to `count` high-potential US-listed equities that credible
   professionals / high-signal communities are currently flagging as breakthrough opportunities;
   weight reputable analysts, notable investors, and substantive Reddit/X/press discussion over hype;
   favor high-potential industries and secular tech/market/economy tailwinds aligned with the current
   market regime (`ctx`); for each return `{symbol, screen: "sentiment"|"thematic", reason}` with a
   one-line credibility-aware reason; cite sources. Explicitly: this is research, not advice; exclude
   pump-and-dump / low-quality hype; prefer liquid names.

4. **Config (`src/config/env.ts`)** — add `MAX_THEMATIC_CANDIDATES` (coerce int nonnegative, default
   5). Append to `.env.example`. (0 disables the thematic pass.)

5. **Universe wiring (Task 9, `src/pipeline/llmReport.ts`)** — after building `ctx` and the quant
   `scan`, also run `const thematic = analyzer ? await analyzer.discoverOpportunities(ctx, app.env.MAX_THEMATIC_CANDIDATES).catch(() => []) : [];`
   then `buildUniverse({ held, watchlist, scan: [...scan, ...thematic] })`. Precedence unchanged
   (held > watchlist > scan/thematic). Dedupe already handled by `buildUniverse` + `runOpportunityScan`'s
   own dedupe; ensure combined scan list is deduped by symbol before universe build.

6. **Tests** — mock `discoverOpportunities` returns deterministic candidates; assert they appear in
   the report's universe (Task 9 test) and that a thematic candidate with no held/watchlist overlap
   shows `source: "scan"` in the universe. Keep everything offline (mock analyzer).

7. **UI (Task 10)** — recommendation cards already show `screen`; ensure `sentiment`/`thematic`
   candidates render their `reason` + `sources` (the card's citations block already covers sources).
