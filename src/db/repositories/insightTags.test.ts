import { beforeEach, describe, expect, test } from "bun:test";
import { repositories } from "../index.ts";
import { openMemoryDb } from "../index.ts";

let repos: ReturnType<typeof repositories>;
const NOW = "2026-06-02T00:00:00.000Z";
const FACT = "source:f1";
beforeEach(() => {
  repos = repositories(openMemoryDb());
});

describe("insightTags", () => {
  test("adds and reads tags across dimensions", () => {
    repos.insightTags.addTag(FACT, { dimension: "ticker", value: "NVDA", source: "ai" }, NOW);
    repos.insightTags.addTag(FACT, { dimension: "sector", value: "Information Technology", source: "ai" }, NOW);
    repos.insightTags.addTag(FACT, { dimension: "direction", value: "bullish", source: "human" }, NOW);
    const tags = repos.insightTags.tagsFor(FACT);
    expect(tags).toContainEqual({ dimension: "ticker", value: "NVDA", source: "ai" });
    expect(tags).toContainEqual({ dimension: "sector", value: "Information Technology", source: "ai" });
    expect(tags).toContainEqual({ dimension: "direction", value: "bullish", source: "human" });
  });

  test("re-adding a tag is idempotent and can flip its source", () => {
    repos.insightTags.addTag(FACT, { dimension: "ticker", value: "NVDA", source: "ai" }, NOW);
    repos.insightTags.addTag(FACT, { dimension: "ticker", value: "NVDA", source: "human" }, NOW);
    const tickers = repos.insightTags.tagsFor(FACT).filter((t) => t.dimension === "ticker");
    expect(tickers).toEqual([{ dimension: "ticker", value: "NVDA", source: "human" }]);
  });

  test("removes a tag", () => {
    repos.insightTags.addTag(FACT, { dimension: "direction", value: "bullish", source: "ai" }, NOW);
    repos.insightTags.removeTag(FACT, "direction", "bullish");
    expect(repos.insightTags.tagsFor(FACT)).toEqual([]);
  });

  test("finds insight nodes by tag and builds a taxonomy with counts", () => {
    repos.insightTags.addTag("source:f1", { dimension: "sector", value: "Energy", source: "ai" }, NOW);
    repos.insightTags.addTag("source:f2", { dimension: "sector", value: "Energy", source: "ai" }, NOW);
    expect(repos.insightTags.insightNodeIdsForTag("sector", "Energy").sort()).toEqual(["source:f1", "source:f2"]);
    expect(repos.insightTags.taxonomy()).toContainEqual({ dimension: "sector", value: "Energy", count: 2 });
  });
});
