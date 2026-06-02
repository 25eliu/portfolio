import type { Macro, MacroSource } from "../types.ts";

export function createFakeMacro(): MacroSource {
  return {
    kind: "fake",
    async get(): Promise<Macro> {
      return {
        tenYearYield: 4.3,
        twoYearYield: 4.6,
        yieldCurveSpread: -0.3,
        fedFunds: 4.5,
        cpiYoY: 3.1,
        unemployment: 4.1,
        vix: 16.5,
      };
    },
  };
}
