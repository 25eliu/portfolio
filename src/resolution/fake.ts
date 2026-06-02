import type { Bar } from "../market/types.ts";
import { fakePrice } from "../market/fake/pricing.ts";
import { isTradingDay } from "./calendar.ts";
import type { HistoricalBarsProvider } from "./provider.ts";

/**
 * Deterministic historical bars for offline/dev resolution. Unlike the live fake gateway (which emits
 * flat bars), these carry a ±2% intraday band around the deterministic close so targets and stops can
 * actually be touched. Resolution unit tests pass hand-crafted bars; this is for the offline pipeline.
 */
export function createFakeBarsProvider(): HistoricalBarsProvider {
  return {
    name: "fake",
    adjustmentPolicyVersion: "none",
    async getDailyBars(symbol: string, start: string, end: string): Promise<Bar[]> {
      const out: Bar[] = [];
      const d = new Date(`${start}T00:00:00.000Z`);
      const endD = new Date(`${end}T00:00:00.000Z`);
      while (d <= endD) {
        const date = d.toISOString().slice(0, 10);
        if (isTradingDay(date)) {
          const close = fakePrice(symbol, date);
          out.push({
            date,
            open: close,
            high: Math.round(close * 1.02 * 100) / 100,
            low: Math.round(close * 0.98 * 100) / 100,
            close,
            volume: 1_000_000,
          });
        }
        d.setUTCDate(d.getUTCDate() + 1);
      }
      return out;
    },
  };
}
