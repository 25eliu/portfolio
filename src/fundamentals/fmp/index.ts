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
    // Fix 3: redact API key from error message — only include path + status
    if (!res.ok) throw new Error(`FMP ${path} → ${res.status}`);
    return res.json();
  }
  const first = (x: unknown): any => (Array.isArray(x) ? x[0] ?? {} : x ?? {});

  return {
    kind: "fmp",
    async get(symbol: string): Promise<Fundamentals> {
      try {
        const [profile, ratios, metrics, growth, target] = await Promise.all([
          fmp(`/profile/${symbol}`).then(first).catch(() => ({})),
          fmp(`/ratios-ttm/${symbol}`).then(first).catch(() => ({})),
          fmp(`/key-metrics-ttm/${symbol}`).then(first).catch(() => ({})),
          fmp(`/financial-growth/${symbol}`, "limit=1").then(first).catch(() => ({})),
          fmp(`/price-target-consensus/${symbol}`).then(first).catch(() => ({})),
        ]);

        // Fix 4: build result immutably as a single object literal
        return Fundamentals.parse({
          symbol,
          name: typeof profile.companyName === "string" ? profile.companyName : null,
          sector: typeof profile.sector === "string" ? profile.sector : null,
          marketCap: n(profile.mktCap),
          peTrailing: n(ratios.priceEarningsRatioTTM),
          // Fix 2: forward PE — try likely field name variants defensively
          peForward: n(ratios.forwardPriceToEarningsRatioTTM) ?? n(ratios.priceEarningsRatioForwardTTM) ?? null,
          ps: n(ratios.priceToSalesRatioTTM),
          pb: n(ratios.priceToBookRatioTTM),
          peg: n(ratios.pegRatioTTM),
          evEbitda: n(metrics.enterpriseValueOverEBITDATTM),
          dividendYield: n(ratios.dividendYielPercentageTTM) ?? n(ratios.dividendYieldTTM),
          grossMargin: pct(ratios.grossProfitMarginTTM),
          operatingMargin: pct(ratios.operatingProfitMarginTTM),
          netMargin: pct(ratios.netProfitMarginTTM),
          roe: pct(ratios.returnOnEquityTTM),
          roa: pct(ratios.returnOnAssetsTTM),
          roic: pct(metrics.roicTTM),
          revenueGrowthYoY: pct(growth.revenueGrowth),
          epsGrowthYoY: pct(growth.epsgrowth),
          debtToEquity: n(ratios.debtEquityRatioTTM),
          currentRatio: n(ratios.currentRatioTTM),
          quickRatio: n(ratios.quickRatioTTM),
          // Fix 1: renamed to freeCashFlowPerShare — FMP value IS per-share
          freeCashFlowPerShare: n(metrics.freeCashFlowPerShareTTM),
          fcfYield: pct(metrics.freeCashFlowYieldTTM),
          // Fix 2: interest coverage — try ratios first, then metrics
          interestCoverage: n(ratios.interestCoverageTTM) ?? n(metrics.interestCoverageTTM) ?? null,
          // analystRating and nextEarningsDate need endpoints not fetched here
          analystRating: null,
          priceTargetMean: n(target.targetConsensus),
          priceTargetHigh: n(target.targetHigh),
          priceTargetLow: n(target.targetLow),
          // Fix 2: numAnalysts — try likely field name variants defensively
          numAnalysts: n(target.numberOfAnalysts) ?? n(target.analystCount) ?? null,
          nextEarningsDate: null,
        });
      } catch (err) {
        // Fix 3: log real bugs visibly with key redacted; premium/blocked endpoints degrade to null
        console.error("[fmp] get failed:", String(err).replaceAll(key, "***"));
        return emptyFundamentals(symbol);
      }
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
