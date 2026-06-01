import { z } from "zod";
import type { Env } from "../../config/env.ts";
import { Fundamentals, emptyFundamentals } from "../../domain/fundamentals.ts";
import type { FundamentalsSource, ScreenCriteria } from "../types.ts";

const BASE = "https://financialmodelingprep.com/api/v3";
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10000) / 100 : null);

export function createFmpFundamentals(env: Env): FundamentalsSource {
  const key = env.FMP_API_KEY;
  async function fmp(path: string, params = ""): Promise<unknown> {
    const sep = params ? "&" : "";
    const res = await fetch(`${BASE}${path}?apikey=${key}${sep}${params}`);
    if (!res.ok) throw new Error(`FMP ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
  }
  const first = (x: unknown): any => (Array.isArray(x) ? x[0] ?? {} : x ?? {});

  return {
    kind: "fmp",
    async get(symbol: string): Promise<Fundamentals> {
      const out = emptyFundamentals(symbol);
      try {
        const [profile, ratios, metrics, growth, target] = await Promise.all([
          fmp(`/profile/${symbol}`).then(first).catch(() => ({})),
          fmp(`/ratios-ttm/${symbol}`).then(first).catch(() => ({})),
          fmp(`/key-metrics-ttm/${symbol}`).then(first).catch(() => ({})),
          fmp(`/financial-growth/${symbol}`, "limit=1").then(first).catch(() => ({})),
          fmp(`/price-target-consensus/${symbol}`).then(first).catch(() => ({})),
        ]);
        out.name = typeof profile.companyName === "string" ? profile.companyName : null;
        out.sector = typeof profile.sector === "string" ? profile.sector : null;
        out.marketCap = n(profile.mktCap);
        out.peTrailing = n(ratios.priceEarningsRatioTTM);
        out.ps = n(ratios.priceToSalesRatioTTM); out.pb = n(ratios.priceToBookRatioTTM);
        out.peg = n(ratios.pegRatioTTM); out.evEbitda = n(metrics.enterpriseValueOverEBITDATTM);
        out.dividendYield = n(ratios.dividendYielPercentageTTM) ?? n(ratios.dividendYieldTTM);
        out.grossMargin = pct(ratios.grossProfitMarginTTM); out.operatingMargin = pct(ratios.operatingProfitMarginTTM);
        out.netMargin = pct(ratios.netProfitMarginTTM); out.roe = pct(ratios.returnOnEquityTTM);
        out.roa = pct(ratios.returnOnAssetsTTM); out.roic = pct(metrics.roicTTM);
        out.debtToEquity = n(ratios.debtEquityRatioTTM); out.currentRatio = n(ratios.currentRatioTTM);
        out.quickRatio = n(ratios.quickRatioTTM); out.freeCashFlow = n(metrics.freeCashFlowPerShareTTM);
        out.fcfYield = pct(metrics.freeCashFlowYieldTTM);
        out.revenueGrowthYoY = pct(growth.revenueGrowth); out.epsGrowthYoY = pct(growth.epsgrowth);
        out.priceTargetMean = n(target.targetConsensus); out.priceTargetHigh = n(target.targetHigh);
        out.priceTargetLow = n(target.targetLow);
      } catch (err) {
        // Premium/blocked endpoints degrade to nulls; never fatal.
      }
      return Fundamentals.parse(out);
    },
    async screen(criteria: ScreenCriteria): Promise<string[]> {
      const parts: string[] = [];
      if (criteria.marketCapMoreThan) parts.push(`marketCapMoreThan=${criteria.marketCapMoreThan}`);
      if (criteria.betaMoreThan) parts.push(`betaMoreThan=${criteria.betaMoreThan}`);
      if (criteria.volumeMoreThan) parts.push(`volumeMoreThan=${criteria.volumeMoreThan}`);
      if (criteria.peLowerThan) parts.push(`peLowerThan=${criteria.peLowerThan}`);
      if (criteria.roeMoreThan) parts.push(`returnOnEquityMoreThan=${criteria.roeMoreThan}`);
      parts.push(`isActivelyTrading=true`, `limit=${criteria.limit ?? 10}`);
      try {
        const raw = await fmp(`/stock-screener`, parts.join("&"));
        const Row = z.object({ symbol: z.string() });
        return z.array(Row).parse(raw).map((r) => r.symbol);
      } catch {
        return [];
      }
    },
  };
}
