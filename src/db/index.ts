import type { DB } from "./connection.ts";
import { portfoliosRepo } from "./repositories/portfolios.ts";
import { holdingsRepo } from "./repositories/holdings.ts";
import { snapshotsRepo } from "./repositories/snapshots.ts";
import { marketSnapshotsRepo } from "./repositories/marketSnapshots.ts";
import { reportsRepo } from "./repositories/reports.ts";
import { runsRepo } from "./repositories/runs.ts";
import { riskProfilesRepo } from "./repositories/riskProfiles.ts";
import { scheduleRepo } from "./repositories/schedule.ts";
import { fundamentalsCacheRepo } from "./repositories/fundamentalsCache.ts";
import { watchlistRepo } from "./repositories/watchlist.ts";
import { journalEntriesRepo } from "./repositories/journalEntries.ts";
import { scoredForecastsRepo } from "./repositories/scoredForecasts.ts";
import { forecastOutcomesRepo } from "./repositories/forecastOutcomes.ts";
import { graphRepo } from "./repositories/graph.ts";
import { knowledgeRepo } from "./repositories/knowledge.ts";
import { wikiRepo } from "./repositories/wiki.ts";
import { tradeDecisionsRepo } from "./repositories/tradeDecisions.ts";
import { queryLogRepo } from "./repositories/queryLog.ts";

export { openDb, openMemoryDb, migrate, type DB } from "./connection.ts";

/** Bundle of all repositories for a database connection. */
export function repositories(db: DB) {
  return {
    portfolios: portfoliosRepo(db),
    holdings: holdingsRepo(db),
    snapshots: snapshotsRepo(db),
    marketSnapshots: marketSnapshotsRepo(db),
    reports: reportsRepo(db),
    runs: runsRepo(db),
    risk: riskProfilesRepo(db),
    schedule: scheduleRepo(db),
    fundamentalsCache: fundamentalsCacheRepo(db),
    watchlist: watchlistRepo(db),
    journalEntries: journalEntriesRepo(db),
    scoredForecasts: scoredForecastsRepo(db),
    forecastOutcomes: forecastOutcomesRepo(db),
    graph: graphRepo(db),
    knowledge: knowledgeRepo(db),
    wiki: wikiRepo(db),
    tradeDecisions: tradeDecisionsRepo(db),
    queryLog: queryLogRepo(db),
  };
}
export type Repositories = ReturnType<typeof repositories>;
