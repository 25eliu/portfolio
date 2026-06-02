import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env as loadEnvSingleton, type Env } from "./config/env.ts";
import { openDb, openMemoryDb, repositories, type DB, type Repositories } from "./db/index.ts";
import { createGateway, type MarketGateway } from "./market/index.ts";
import { cached, createFundamentals, type FundamentalsSource } from "./fundamentals/index.ts";
import { createGeminiAnalyzer } from "./llm/gemini.ts";
import type { Analyzer } from "./llm/analyze.ts";
import { newId, today, type Portfolio } from "./domain/index.ts";

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
};

export type CreateAppOptions = {
  env?: Env;
  db?: DB;
  gateway?: MarketGateway;
  now?: () => string;
  analyzer?: Analyzer | null;
  fundamentals?: FundamentalsSource;
};

/** Ensure the two first-class portfolios exist; return them. */
function bootstrapPortfolios(repos: Repositories): { user: Portfolio; ai: Portfolio } {
  const ensure = (
    kind: Portfolio["kind"],
    name: string,
    decisionSource: Portfolio["decisionSource"],
  ): Portfolio => {
    const existing = repos.portfolios.getByKind(kind);
    if (existing) return existing;
    return repos.portfolios.insert({
      id: newId(),
      name,
      kind,
      decisionSource,
      alpacaAccount: null,
      cash: 0,
      createdAt: new Date().toISOString(),
    });
  };
  return {
    user: ensure("user", "My Portfolio", "manual"),
    ai: ensure("ai_shadow", "AI Portfolio", "llm"),
  };
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
  const { user, ai } = bootstrapPortfolios(repos);
  return { env, db, repos, gateway, now: opts.now ?? (() => today()), user, ai, analyzer, fundamentals };
}
