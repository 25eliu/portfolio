import { beforeEach, describe, expect, test } from "bun:test";
import { openMemoryDb, repositories } from "../index.ts";
import type { KnowledgeSource } from "../../domain/index.ts";

let repos: ReturnType<typeof repositories>;
const NOW = "2026-06-02T00:00:00.000Z";

beforeEach(() => {
  repos = repositories(openMemoryDb());
});

function insertSource(
  id: string,
  trustClass: KnowledgeSource["trustClass"],
  kind: KnowledgeSource["kind"] = trustClass === "self_curated" ? "fact" : "note",
) {
  repos.knowledge.insertSource({
    id, kind, title: `t-${id}`,
    trustClass, scope: "global", scopeTicker: null, useInAnalysis: true,
    status: "active", origin: null, createdAt: NOW, updatedAt: NOW,
  });
}

describe("listUserSources", () => {
  test("allowlists the user's own note/url/upload kinds; excludes AI + system content", () => {
    insertSource("u-note", "private_note", "note");
    insertSource("u-url", "public_url", "url");
    insertSource("u-file", "public_upload", "upload");
    insertSource("ai-fact", "self_curated", "fact"); // AI Library — must not appear
    insertSource("sys-lesson", "system_lesson", "fact"); // system-generated — must not appear
    const user = repos.knowledge.listUserSources();
    expect(user.map((s) => s.id).sort()).toEqual(["u-file", "u-note", "u-url"]);
    // listSources still returns everything (unchanged behavior)
    expect(repos.knowledge.listSources().length).toBe(5);
  });
});
