export type Macro = {
  tenYearYield: number | null;
  twoYearYield: number | null;
  yieldCurveSpread: number | null;
  fedFunds: number | null;
  cpiYoY: number | null;
  unemployment: number | null;
  vix: number | null;
};

export interface MacroSource {
  readonly kind: "fred" | "fake";
  get(): Promise<Macro>;
}
