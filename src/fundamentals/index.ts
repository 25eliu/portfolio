import type { Env } from "../config/env.ts";
import type { Repositories } from "../db/index.ts";
import { today } from "../domain/ids.ts";
import { createFakeFundamentals } from "./fake/index.ts";
import { createFmpFundamentals } from "./fmp/index.ts";
import type { FundamentalsSource } from "./types.ts";

export * from "./types.ts";
export { createFakeFundamentals } from "./fake/index.ts";

/** Wrap a source with a per-day SQLite cache so each symbol is fetched at most once per day. */
export function cached(
  source: FundamentalsSource,
  repos: Repositories,
  now: () => string = () => today(),
): FundamentalsSource {
  return {
    kind: source.kind,
    async get(symbol) {
      const date = now();
      const hit = repos.fundamentalsCache.get(symbol, date);
      if (hit) return hit;
      const fresh = await source.get(symbol);
      repos.fundamentalsCache.put(symbol, date, fresh);
      return fresh;
    },
    screen: (c) => source.screen(c),
  };
}

export function createFundamentals(env: Env): FundamentalsSource {
  return env.FMP_API_KEY ? createFmpFundamentals(env) : createFakeFundamentals();
}
