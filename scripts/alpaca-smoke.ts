/**
 * Smoke test: confirm Alpaca paper credentials work before building further.
 *   bun run alpaca:smoke
 * Requires ALPACA_KEY_ID / ALPACA_SECRET in .env (paper keys only).
 */
import { loadEnv } from "../src/config/env.ts";

const e = loadEnv();

if (!e.ALPACA_KEY_ID || !e.ALPACA_SECRET) {
  console.error(
    "✗ No Alpaca credentials found.\n" +
      "  1. Sign up free at https://alpaca.markets\n" +
      "  2. Switch to Paper Trading, generate an API Key ID + Secret\n" +
      "  3. Put them in .env as ALPACA_KEY_ID / ALPACA_SECRET\n",
  );
  process.exit(1);
}

const url = `${e.ALPACA_TRADING_BASE_URL}/v2/account`;
console.log(`→ GET ${url}`);

const res = await fetch(url, {
  headers: {
    "APCA-API-KEY-ID": e.ALPACA_KEY_ID,
    "APCA-API-SECRET-KEY": e.ALPACA_SECRET,
  },
});

if (!res.ok) {
  const body = await res.text();
  console.error(`✗ Alpaca returned ${res.status} ${res.statusText}\n${body}`);
  process.exit(1);
}

const account = (await res.json()) as {
  account_number?: string;
  status?: string;
  cash?: string;
  portfolio_value?: string;
  buying_power?: string;
};

console.log("✓ Alpaca paper account reachable:");
console.log(`  account_number : ${account.account_number}`);
console.log(`  status         : ${account.status}`);
console.log(`  cash           : ${account.cash}`);
console.log(`  portfolio_value: ${account.portfolio_value}`);
console.log(`  buying_power   : ${account.buying_power}`);
