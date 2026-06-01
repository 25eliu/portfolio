import { z } from "zod";

/**
 * Environment configuration, validated at startup (fail fast at the system boundary).
 * Secrets come from the environment only — never hardcoded, paper keys only.
 */
const EnvSchema = z.object({
  MARKET_ADAPTER: z.enum(["alpaca", "fake"]).default("fake"),
  ALPACA_KEY_ID: z.string().default(""),
  ALPACA_SECRET: z.string().default(""),
  ALPACA_PAPER: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  ALPACA_TRADING_BASE_URL: z
    .string()
    .url()
    .default("https://paper-api.alpaca.markets"),
  ALPACA_DATA_BASE_URL: z.string().url().default("https://data.alpaca.markets"),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_PATH: z.string().default("./data/portfolio.sqlite"),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parse and validate a record (defaults to process.env). Throws a readable error on failure. */
export function loadEnv(source: Record<string, string | undefined> = Bun.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = result.data;
  if (env.MARKET_ADAPTER === "alpaca" && (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET)) {
    throw new Error(
      "MARKET_ADAPTER=alpaca requires ALPACA_KEY_ID and ALPACA_SECRET. " +
        "Set them in .env (paper keys only) or switch MARKET_ADAPTER=fake.",
    );
  }
  if (env.MARKET_ADAPTER === "alpaca" && !env.ALPACA_PAPER) {
    throw new Error("Refusing to start: ALPACA_PAPER must be true. This system is paper-only.");
  }
  return env;
}

let cached: Env | undefined;

/** Process-wide singleton accessor for validated env. */
export function env(): Env {
  return (cached ??= loadEnv());
}
