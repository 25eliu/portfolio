/** Confirm FMP credentials + inspect which fields your plan returns. Run: bun run fmp:smoke
 *  REQUIRES a live FMP_API_KEY (not available in CI/sandbox). Null fields are premium-gated by design. */
import { loadEnv } from "../src/config/env.ts";
import { createFmpFundamentals } from "../src/fundamentals/fmp/index.ts";

const env = loadEnv();
if (!env.FMP_API_KEY) {
  console.error("Set FMP_API_KEY in .env");
  process.exit(1);
}
const f = createFmpFundamentals(env);
console.log(JSON.stringify(await f.get("AAPL"), null, 2));
console.log("value screen:", await f.screen({ peLowerThan: 20, marketCapMoreThan: 2e9, limit: 5 }));
