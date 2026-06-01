import { expect, test } from "@playwright/test";

/**
 * Critical-path E2E (against the fake adapter): add a holding → seed AI → run analysis →
 * dual view + equity curve + recommendation cards update.
 */
test("add holding, seed, run, and see the report", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Portfolio Intelligence" })).toBeVisible();

  // Add a holding via the ticker manager.
  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByPlaceholder("AAPL").fill("AAPL");
  await page.getByPlaceholder("10").fill("10");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("cell", { name: "AAPL", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // Seed the AI paper account, then run the pipeline.
  await page.getByRole("button", { name: "Seed AI" }).click();
  await page.getByRole("button", { name: "Run analysis" }).click();
  await expect(page.getByText("Analysis complete")).toBeVisible();

  // My Portfolio panel shows the priced holding.
  await expect(page.getByText("AAPL").first()).toBeVisible();

  // Daily recommendations rendered at least one card.
  await expect(page.getByText("Conviction").first()).toBeVisible();

  // Equity curve legend present.
  await expect(page.getByText("SPY").first()).toBeVisible();
});

test("rejects an invalid holding", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Manage" }).click();
  await page.getByPlaceholder("AAPL").fill("AAPL");
  await page.getByPlaceholder("10").fill("-5");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(/positive share count/)).toBeVisible();
});
