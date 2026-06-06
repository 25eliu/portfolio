import { z } from "zod";
import type { Env } from "../config/env.ts";
import type { Bar } from "../market/types.ts";
import type { HistoricalBarsProvider } from "./provider.ts";

/**
 * Alpaca historical daily bars for resolution. Uses `adjustment=all` (splits + dividends) so target/
 * stop levels are compared against corporate-action-adjusted prices, and paginates with
 * `next_page_token` across long ranges. See https://docs.alpaca.markets/reference/stockbars.
 */
const PageRes = z.object({
  bars: z
    .array(z.object({ t: z.string(), o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number() }))
    .nullable()
    .default([]),
  next_page_token: z.string().nullable().default(null),
});

const ADJUSTMENT_POLICY_VERSION = "all-v1";

export function createAlpacaBarsProvider(env: Env): HistoricalBarsProvider {
  const authHeaders = {
    "APCA-API-KEY-ID": env.ALPACA_KEY_ID,
    "APCA-API-SECRET-KEY": env.ALPACA_SECRET,
  };

  return {
    name: "alpaca",
    adjustmentPolicyVersion: ADJUSTMENT_POLICY_VERSION,
    async getDailyBars(symbol: string, start: string, end: string): Promise<Bar[]> {
      const out: Bar[] = [];
      let pageToken: string | null = null;
      do {
        const params = new URLSearchParams({
          timeframe: "1Day",
          start,
          end,
          adjustment: "all",
          feed: "iex",
          limit: "10000",
        });
        if (pageToken) params.set("page_token", pageToken);
        const res = await fetch(`${env.ALPACA_DATA_BASE_URL}/v2/stocks/${symbol}/bars?${params}`, {
          headers: { ...authHeaders, "Content-Type": "application/json" },
        });
        if (!res.ok) {
          throw new Error(`Alpaca bars ${symbol} → ${res.status}: ${await res.text()}`);
        }
        const page = PageRes.parse(await res.json());
        for (const b of page.bars ?? []) {
          out.push({ date: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v });
        }
        pageToken = page.next_page_token;
      } while (pageToken);
      return out;
    },
  };
}
