import type { DB } from "./connection.ts";
import { portfoliosRepo } from "./repositories/portfolios.ts";
import { holdingsRepo } from "./repositories/holdings.ts";
import { snapshotsRepo } from "./repositories/snapshots.ts";
import { marketSnapshotsRepo } from "./repositories/marketSnapshots.ts";
import { reportsRepo } from "./repositories/reports.ts";
import { runsRepo } from "./repositories/runs.ts";
import { riskProfilesRepo } from "./repositories/riskProfiles.ts";

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
  };
}
export type Repositories = ReturnType<typeof repositories>;
