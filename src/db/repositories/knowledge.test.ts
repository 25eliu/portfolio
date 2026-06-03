import { beforeEach, describe, expect, test } from "bun:test";
import { openMemoryDb } from "../index.ts";
import { repositories } from "../index.ts";

let repos: ReturnType<typeof repositories>;
const NOW = "2026-06-02T00:00:00.000Z";

beforeEach(() => {
  repos = repositories(openMemoryDb());
});

function insertSource(id: string, trustClass: string) {
  repos.knowledge.insertSource({
    id, kind: trustClass === "self_curated" ? "fact" : "note", title: `t-${id}`,
    trustClass, scope: "global", scopeTicker: null, useInAnalysis: true,
    status: "active", origin: null, createdAt: NOW, updatedAt: NOW,
  });
}

describe("listUserSources", () => {
  test("excludes self_curated facts (they live in the AI Library)", () => {
    insertSource("u1", "private_note");
    insertSource("a1", "self_curated");
    const user = repos.knowledge.listUserSources();
    expect(user.map((s) => s.id)).toEqual(["u1"]);
    // listSources still returns everything (unchanged behavior)
    expect(repos.knowledge.listSources().length).toBe(2);
  });
});
