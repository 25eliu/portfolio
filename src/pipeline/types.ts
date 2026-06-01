import type { DailyReport, PortfolioKind, PricedPosition } from "../domain/index.ts";

/** A portfolio valued at run time — the unit the dual view + equity curve render from. */
export type PricedPortfolio = {
  portfolioId: string;
  kind: PortfolioKind;
  name: string;
  positions: PricedPosition[];
  cash: number;
  /** cash + market value of all positions. */
  equity: number;
  /** Cost value of positions with a known basis (avg entry for AI). */
  costValue: number;
  /** Unrealized P&L vs cost over positions with a known basis. */
  totalPnL: number;
  /** Change in equity vs the previous snapshot (null if this is the first). */
  dayPnL: number | null;
};

export type RunResult = {
  runId: string;
  date: string;
  status: "ok" | "error";
  portfolios: PricedPortfolio[];
  report: DailyReport;
};
