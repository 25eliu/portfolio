/**
 * Test preload (configured in bunfig.toml `[test] preload`). Bun auto-loads `.env`, so once real
 * GEMINI/FMP/Alpaca keys exist there, `createApp()` would otherwise construct LIVE clients and make
 * network calls during tests. Force the hermetic defaults: fake market adapter, no LLM/FMP keys
 * (→ analyzer null + fake fundamentals → deterministic offline runs). Tests that want the real
 * thing inject their own gateway/analyzer/fundamentals explicitly.
 */
process.env.MARKET_ADAPTER = "fake";
process.env.GEMINI_API_KEY = "";
process.env.FMP_API_KEY = "";
process.env.ALPACA_KEY_ID = "";
process.env.ALPACA_SECRET = "";
