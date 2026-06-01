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
