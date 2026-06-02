import type { Env } from "../../config/env.ts";
import type { Macro, MacroSource } from "../types.ts";

const BASE = "https://api.stlouisfed.org/fred/series/observations";

async function latest(key: string, series: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${BASE}?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=1`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { observations?: { value?: string }[] };
    const v = j.observations?.[0]?.value;
    const n = v != null ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function cpiYoY(key: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${BASE}?series_id=CPIAUCSL&api_key=${key}&file_type=json&sort_order=desc&limit=13`,
    );
    if (!res.ok) return null;
    const obs = ((await res.json()) as { observations?: { value?: string }[] }).observations ?? [];
    const now = Number(obs[0]?.value);
    const yearAgo = Number(obs[12]?.value);
    return Number.isFinite(now) && Number.isFinite(yearAgo) && yearAgo > 0
      ? Math.round(((now - yearAgo) / yearAgo) * 1000) / 10
      : null;
  } catch {
    return null;
  }
}

export function createFredMacro(env: Env): MacroSource {
  const key = env.FRED_API_KEY;
  return {
    kind: "fred",
    async get(): Promise<Macro> {
      const [ten, two, spread, ff, cpi, unemp, vix] = await Promise.all([
        latest(key, "DGS10"),
        latest(key, "DGS2"),
        latest(key, "T10Y2Y"),
        latest(key, "FEDFUNDS"),
        cpiYoY(key),
        latest(key, "UNRATE"),
        latest(key, "VIXCLS"),
      ]);
      return {
        tenYearYield: ten,
        twoYearYield: two,
        yieldCurveSpread: spread,
        fedFunds: ff,
        cpiYoY: cpi,
        unemployment: unemp,
        vix,
      };
    },
  };
}
