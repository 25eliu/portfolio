// Re-export backend types so the UI shares one source of truth with the server contract.
export type {
  Holding,
  HoldingInput,
  DailyReport,
  Recommendation,
  Action,
  Horizon,
  Snapshot,
  MarketSnapshot,
  RiskProfile,
  RiskPreset,
  Schedule,
  MarketContext,
  WatchlistItem,
} from "@shared/domain/index.ts";
export type { PricedPortfolio, RunResult } from "@shared/pipeline/types.ts";
export type { Run } from "@shared/db/repositories/runs.ts";
