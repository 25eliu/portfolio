import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env as loadEnvSingleton, type Env } from "./config/env.ts";
import { openDb, openMemoryDb, repositories, type DB, type Repositories } from "./db/index.ts";
import { createGateway, type MarketGateway } from "./market/index.ts";
import { cached, createFundamentals, type FundamentalsSource } from "./fundamentals/index.ts";
import { createGeminiAnalyzer } from "./llm/gemini.ts";
import type { Analyzer } from "./llm/analyze.ts";
import { AI_STARTING_CASH, newId, today, type Portfolio } from "./domain/index.ts";
import { createMacro, type MacroSource } from "./macro/index.ts";
import { createBarsProvider, type HistoricalBarsProvider } from "./resolution/index.ts";
import { createQueryModel, type QueryModel } from "./query/index.ts";

/** Everything the pipeline and server need, wired once. */
export type App = {
  env: Env;
  db: DB;
  repos: Repositories;
  gateway: MarketGateway;
  now: () => string;
  user: Portfolio;
  ai: Portfolio;
  analyzer: Analyzer | null;
  fundamentals: FundamentalsSource;
  macro: MacroSource;
  /** Historical daily bars for forecast resolution (split/dividend-adjusted, ranged). */
  barsProvider: HistoricalBarsProvider;
  /** Grounded NL-query model (Gemini tool-use); null when no model is configured. */
  queryModel: QueryModel | null;
};

export type CreateAppOptions = {
  env?: Env;
  db?: DB;
  gateway?: MarketGateway;
  now?: () => string;
  analyzer?: Analyzer | null;
  fundamentals?: FundamentalsSource;
  macro?: MacroSource;
  barsProvider?: HistoricalBarsProvider;
  queryModel?: QueryModel | null;
};

/** Ensure the two first-class portfolios exist; return them. */
function bootstrapPortfolios(repos: Repositories): { user: Portfolio; ai: Portfolio } {
  const ensure = (
    kind: Portfolio["kind"],
    name: string,
    decisionSource: Portfolio["decisionSource"],
    cash: number,
  ): Portfolio => {
    const existing = repos.portfolios.getByKind(kind);
    if (existing) return existing;
    return repos.portfolios.insert({
      id: newId(),
      name,
      kind,
      decisionSource,
      alpacaAccount: null,
      cash,
      createdAt: new Date().toISOString(),
    });
  };
  const user = ensure("user", "My Portfolio", "manual", 0);
  const ai = ensure("ai_shadow", "AI Portfolio", "llm", AI_STARTING_CASH);

  // Idempotent top-up for dev DBs created before the isolated $100k book: only ever fires on an AI
  // portfolio that is genuinely fresh (no cash, no holdings, no snapshots) — never on a live book.
  if (
    ai.cash === 0 &&
    repos.holdings.listByPortfolio(ai.id).length === 0 &&
    repos.snapshots.listByPortfolio(ai.id).length === 0
  ) {
    repos.portfolios.setCash(ai.id, AI_STARTING_CASH);
    return { user, ai: { ...ai, cash: AI_STARTING_CASH } };
  }
  return { user, ai };
}

/** Build the application context. In-memory + fake by default when nothing is provided. */
export function createApp(opts: CreateAppOptions = {}): App {
  const env = opts.env ?? loadEnvSingleton();
  const db =
    opts.db ??
    (env.DATABASE_PATH === ":memory:"
      ? openMemoryDb()
      : (mkdirSync(dirname(env.DATABASE_PATH), { recursive: true }), openDb(env.DATABASE_PATH)));
  const repos = repositories(db);
  const gateway = opts.gateway ?? createGateway(env);
  const fundamentals =
    opts.fundamentals ?? cached(createFundamentals(env), repos, opts.now ?? (() => today()));
  const analyzer =
    opts.analyzer ?? (env.GEMINI_API_KEY ? createGeminiAnalyzer(env) : null);
  const macro = opts.macro ?? createMacro(env);
  const barsProvider = opts.barsProvider ?? createBarsProvider(env);
  const queryModel = opts.queryModel !== undefined ? opts.queryModel : createQueryModel(env);
  repos.runs.abandonRunning(); // clear stale "running" rows from a previously-killed process
  const { user, ai } = bootstrapPortfolios(repos);
  return { env, db, repos, gateway, now: opts.now ?? (() => today()), user, ai, analyzer, fundamentals, macro, barsProvider, queryModel };
}
