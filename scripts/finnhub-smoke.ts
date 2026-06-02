import { loadEnv } from "../src/config/env.ts";
import { finnhubAnalystRating, finnhubNextEarnings } from "../src/fundamentals/finnhub/index.ts";

const env = loadEnv();
if (!env.FINNHUB_API_KEY) {
  console.error("FINNHUB_API_KEY is not set. Sign up for a free key at https://finnhub.io");
  process.exit(1);
}

const symbol = process.argv[2] ?? "AAPL";
console.log(`Fetching Finnhub data for ${symbol}...`);

const [rating, earnings] = await Promise.all([
  finnhubAnalystRating(env, symbol),
  finnhubNextEarnings(env, symbol),
]);

console.log(JSON.stringify({ symbol, analystRating: rating, nextEarningsDate: earnings }, null, 2));
