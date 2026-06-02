import type { Env } from "../config/env.ts";
import { createFakeMacro } from "./fake/index.ts";
import { createFredMacro } from "./fred/index.ts";
import type { MacroSource } from "./types.ts";

export * from "./types.ts";

export function createMacro(env: Env): MacroSource {
  return env.FRED_API_KEY ? createFredMacro(env) : createFakeMacro();
}
