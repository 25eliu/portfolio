import { expect, test } from "@playwright/test";

/**
 * Critical-path E2E (against the fake adapter): add a holding → run analysis →
 * dual view + equity curve + recommendation cards update.
 */
test("add holding, run, and see the report", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Portfolio Intelligence" })).toBeVisible();

  // Add a holding via the ticker manager.
  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByPlaceholder("AAPL").fill("AAPL");
  await page.getByPlaceholder("10").fill("10");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("cell", { name: "AAPL", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // Run the pipeline.
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.getByText("Analysis complete")).toBeVisible();

  // My Portfolio panel shows the priced holding.
  await expect(page.getByText("AAPL").first()).toBeVisible();

  // Daily recommendations rendered at least one card.
  await expect(page.getByText("Conviction").first()).toBeVisible();

  // Equity curve legend present.
  await expect(page.getByText("SPY").first()).toBeVisible();

  // The journal recorded the run's recommendations (rendered from the DB, not LLM recall).
  const journal = page.locator("#journal");
  await expect(journal.getByText("by day — click a day to see that day's calls")).toBeVisible();
  await expect(journal.getByText("AAPL").first()).toBeVisible();

  // Self-curated memory captured a durable fact from the run and feeds it back into future analysis.
  await expect(page.getByText("Self-curated memory")).toBeVisible();
  await expect(page.getByText(/durable competitive characteristic/).first()).toBeVisible();
});

test("rejects an invalid holding", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByPlaceholder("AAPL").fill("AAPL");
  await page.getByPlaceholder("10").fill("-5");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(/positive share count/)).toBeVisible();
});

test("add a watchlist symbol", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByPlaceholder("Add to watchlist").fill("TSLA");
  await page.getByRole("button", { name: "Watch" }).click();
  await expect(page.getByText("TSLA").first()).toBeVisible();
});
