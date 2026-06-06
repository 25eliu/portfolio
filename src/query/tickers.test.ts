import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { mentionableTickers, parseMentions } from "./tickers.ts";

let app: App;
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway(), now: () => "2026-06-02", queryModel: null });
});

describe("parseMentions", () => {
  test("extracts @TICKER mentions, uppercased and de-duped", () => {
    expect(parseMentions("how is @nvda doing vs @AAPL and @nvda again?")).toEqual(["NVDA", "AAPL"]);
  });
  test("ignores emails and bare text with no mentions", () => {
    expect(parseMentions("no tickers here, email a@b.com")).toEqual([]);
  });
  test("handles dotted symbols like @BRK.B", () => {
    expect(parseMentions("buy @BRK.B")).toEqual(["BRK.B"]);
  });
});

describe("mentionableTickers", () => {
  test("merges holdings, AI book, and watchlist, tagging each with every source", () => {
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 10, costBasis: 100 });
    app.repos.holdings.upsert(app.ai.id, { symbol: "NVDA", shares: 5, costBasis: 50 });
    app.repos.holdings.upsert(app.ai.id, { symbol: "AAPL", shares: 3, costBasis: 90 });
    app.repos.watchlist.add({ symbol: "TSLA", note: null });

    const tickers = mentionableTickers(app);
    const bySym = new Map(tickers.map((t) => [t.symbol, t.sources]));
    expect(tickers.map((t) => t.symbol)).toEqual(["AAPL", "NVDA", "TSLA"]); // sorted
    expect(bySym.get("AAPL")).toEqual(["holding", "ai"]); // in both books → both tags, ordered
    expect(bySym.get("NVDA")).toEqual(["ai"]);
    expect(bySym.get("TSLA")).toEqual(["watchlist"]);
  });

  test("returns an empty list on a fresh app", () => {
    expect(mentionableTickers(app)).toEqual([]);
  });
});
