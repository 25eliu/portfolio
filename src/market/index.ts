import { env as loadEnvSingleton, type Env } from "../config/env.ts";
import { createFakeGateway } from "./fake/index.ts";
import { createAlpacaGateway } from "./alpaca/index.ts";
import type { MarketGateway } from "./types.ts";

export * from "./types.ts";
export { createFakeGateway } from "./fake/index.ts";
export { createAlpacaGateway } from "./alpaca/index.ts";

/** Build the gateway selected by MARKET_ADAPTER (fake by default). */
export function createGateway(env: Env = loadEnvSingleton()): MarketGateway {
  return env.MARKET_ADAPTER === "alpaca" ? createAlpacaGateway(env) : createFakeGateway();
}
