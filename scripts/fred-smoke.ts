import { loadEnv } from "../src/config/env.ts";
import { createFredMacro } from "../src/macro/fred/index.ts";

const env = loadEnv();
const macro = createFredMacro(env);
console.log("Fetching FRED macro data...");
const result = await macro.get();
console.log(JSON.stringify(result, null, 2));
