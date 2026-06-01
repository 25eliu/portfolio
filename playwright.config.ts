import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Boots the full stack (`bun run dev` → backend + Vite) and drives the dashboard.
 * One-time setup: `bunx playwright install chromium`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 30_000,
  use: { baseURL: "http://localhost:5173", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run dev",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 30_000,
    env: { MARKET_ADAPTER: "fake", DATABASE_PATH: "./data/e2e.sqlite", GEMINI_API_KEY: "", FMP_API_KEY: "" },
  },
});
