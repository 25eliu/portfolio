import { describe, expect, test } from "bun:test";
import { classifyRegime, regimeSizingMultiplier } from "./regime.ts";

describe("classifyRegime", () => {
  test("calm uptrend with low VIX → risk_on", () => {
    expect(classifyRegime({ spyTrend: "up", vix: 13 })).toBe("risk_on");
  });

  test("downtrend with an outlook risk_off stance → risk_off", () => {
    expect(classifyRegime({ spyTrend: "down", vix: 28, outlookStance: "risk_off" })).toBe("risk_off");
  });

  test("a defensive outlook alone is enough for risk_off", () => {
    expect(classifyRegime({ spyTrend: "sideways", vix: null, outlookStance: "defensive" })).toBe("risk_off");
  });

  test("mixed signals settle on neutral", () => {
    expect(classifyRegime({ spyTrend: "sideways", vix: 18 })).toBe("neutral");
  });
});

describe("regimeSizingMultiplier", () => {
  test("only risk_off brakes sizing", () => {
    expect(regimeSizingMultiplier("risk_off")).toBe(0.8);
    expect(regimeSizingMultiplier("neutral")).toBe(1);
    expect(regimeSizingMultiplier("risk_on")).toBe(1);
  });
});
