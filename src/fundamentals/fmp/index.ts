import { z } from "zod";
import type { Env } from "../../config/env.ts";
import { Fundamentals, emptyFundamentals } from "../../domain/fundamentals.ts";
import type { FundamentalsSource, ScreenCriteria } from "../types.ts";

/**
 * FMP adapter — targets the "stable" API (`/stable/<endpoint>?symbol=X`). The legacy `/api/v3/...`
 * path endpoints are gated on the current free tier; the stable endpoints return full data. Field
 * names below were confirmed live against the stable API. Margins / ROE / yields / growth come back
 * as decimals (0.478 = 47.8%) so they go through `pct()`; ratios/counts/targets use `n()`.
 * NOTE: the `company-screener` endpoint is paid-only (HTTP 402 on free) — `screen()` degrades to [].
 */
const BASE = "https://financialmodelingprep.com/stable";
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10000) / 100 : null;

export function createFmpFundamentals(env: Env): FundamentalsSource {
  const key = env.FMP_API_KEY;
  async function fmp(endpoint: string, params = ""): Promise<unknown> {
    const sep = params ? "&" : "";
    const res = await fetch(`${BASE}/${endpoint}?apikey=${key}${sep}${params}`);
    if (!res.ok) throw new Error(`FMP ${endpoint} → ${res.status}`); // key never in the message
    return res.json();
  }
  const first = (x: unknown): any => (Array.isArray(x) ? (x[0] ?? {}) : (x ?? {}));
  const forSymbol = (endpoint: string, sym: string, extra = "") =>
    fmp(endpoint, `symbol=${encodeURIComponent(sym)}${extra}`);

  return {
    kind: "fmp",
    async get(symbol: string): Promise<Fundamentals> {
      try {
        const [profile, ratios, metrics, growth, target, ptSummary] = await Promise.all([
          forSymbol("profile", symbol).then(first).catch(() => ({})),
          forSymbol("ratios-ttm", symbol).then(first).catch(() => ({})),
          forSymbol("key-metrics-ttm", symbol).then(first).catch(() => ({})),
          forSymbol("financial-growth", symbol, "&limit=1").then(first).catch(() => ({})),
          forSymbol("price-target-consensus", symbol).then(first).catch(() => ({})),
          forSymbol("price-target-summary", symbol).then(first).catch(() => ({})),
        ]);

        return Fundamentals.parse({
          symbol,
          name: typeof profile.companyName === "string" ? profile.companyName : null,
          sector: typeof profile.sector === "string" ? profile.sector : null,
          marketCap: n(profile.marketCap),
          peTrailing: n(ratios.priceToEarningsRatioTTM),
          peForward: null, // not exposed by the stable TTM endpoints
          ps: n(ratios.priceToSalesRatioTTM),
          pb: n(ratios.priceToBookRatioTTM),
          peg: n(ratios.priceToEarningsGrowthRatioTTM),
          evEbitda: n(metrics.evToEBITDATTM),
          fcfYield: pct(metrics.freeCashFlowYieldTTM),
          dividendYield: pct(ratios.dividendYieldTTM),
          grossMargin: pct(ratios.grossProfitMarginTTM),
          operatingMargin: pct(ratios.operatingProfitMarginTTM),
          netMargin: pct(ratios.netProfitMarginTTM),
          roe: pct(metrics.returnOnEquityTTM),
          roa: pct(metrics.returnOnAssetsTTM),
          roic: pct(metrics.returnOnInvestedCapitalTTM),
          revenueGrowthYoY: pct(growth.revenueGrowth),
          epsGrowthYoY: pct(growth.epsgrowth),
          debtToEquity: n(ratios.debtToEquityRatioTTM),
          currentRatio: n(ratios.currentRatioTTM),
          quickRatio: n(ratios.quickRatioTTM),
          freeCashFlowPerShare: n(ratios.freeCashFlowPerShareTTM),
          interestCoverage: n(ratios.interestCoverageRatioTTM),
          analystRating: null, // needs the grades endpoint (not fetched)
          priceTargetMean: n(target.targetConsensus),
          priceTargetHigh: n(target.targetHigh),
          priceTargetLow: n(target.targetLow),
          numAnalysts:
            n(ptSummary.lastQuarterCount) ?? n(ptSummary.lastYearCount) ?? n(ptSummary.allTimeCount),
          nextEarningsDate: null,
        });
      } catch (err) {
        console.error("[fmp] get failed:", String(err).replaceAll(key, "***"));
        return emptyFundamentals(symbol);
      }
    },

    async screen(criteria: ScreenCriteria): Promise<string[]> {
      // stable company-screener supports marketCap/beta/volume filters (P/E & ROE are not screen
      // params); it is paid-only on the free tier (402) → degrade to [] so the scan still runs.
      const parts: string[] = [];
      if (criteria.marketCapMoreThan) parts.push(`marketCapMoreThan=${criteria.marketCapMoreThan}`);
      if (criteria.betaMoreThan) parts.push(`betaMoreThan=${criteria.betaMoreThan}`);
      if (criteria.volumeMoreThan) parts.push(`volumeMoreThan=${criteria.volumeMoreThan}`);
      parts.push(`isActivelyTrading=true`, `limit=${criteria.limit ?? 10}`);
      try {
        const raw = await fmp("company-screener", parts.join("&"));
        const Row = z.object({ symbol: z.string() });
        return z.array(Row).parse(raw).map((r) => r.symbol);
      } catch {
        return [];
      }
    },
  };
}
