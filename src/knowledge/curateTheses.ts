import type { App } from "../app.ts";
import { newId, nodeId, edgeId, thesisSubjectKey, addDays, THESIS_FRESHNESS_DAYS, type Outlook, type ThesisItem } from "../domain/index.ts";

/** Regime stance → a coarse direction tag for filtering (risk_on→bullish, risk_off/defensive→bearish). */
function stanceDirection(stance: string): "bullish" | "bearish" | "neutral" {
  if (stance === "bullish" || stance === "risk_on") return "bullish";
  if (stance === "bearish" || stance === "risk_off" || stance === "defensive") return "bearish";
  return "neutral";
}

type OutlookReport = { id: string; outlook: Outlook | null };

/**
 * Persist a run's outlook as superseding theses: one ai_theses row per item (regime + sectors + themes),
 * the prior active thesis for each subject flipped to superseded, a thesis:<id> graph node, auto-tags
 * (sector/theme/direction/horizon + ticker mentions), resolvable citation sources + cites edges, and a
 * horizon-derived freshness deadline. Mirrors curateFacts.
 */
export function persistOutlook(app: App, report: OutlookReport, runId: string | null, now: string): { added: number } {
  const o = report.outlook;
  if (!o) return { added: 0 };
  const date = now.slice(0, 10);
  let added = 0;

  const items: { level: "regime" | "sector" | "theme"; item: ThesisItem }[] = [
    ...(o.regime ? [{ level: "regime" as const, item: o.regime }] : []),
    ...o.sectors.map((item) => ({ level: "sector" as const, item })),
    ...o.themes.map((item) => ({ level: "theme" as const, item })),
  ];

  for (const { level, item } of items) {
    const subjectKey = thesisSubjectKey(level, item.subject);
    const prior = app.repos.aiTheses.supersedePriorActive(subjectKey);
    const id = newId();
    // Persist each citation URL as a resolvable knowledge_source (deduped) and carry its id on the thesis.
    const citedSources = item.sources.map((s) => ({
      title: s.title, url: s.url, sourceId: app.repos.knowledge.findOrCreateCitationSource(s.url, s.title, now),
    }));
    app.repos.aiTheses.insert({
      id, runId, reportId: report.id, date, createdAt: now,
      level, subject: item.subject, subjectKey, stance: item.stance, conviction: item.conviction,
      horizon: item.horizon, summary: item.summary, thesis: item.thesis, status: "active",
      supersedesId: prior[0] ?? null,
      freshnessDeadline: addDays(date, THESIS_FRESHNESS_DAYS[item.horizon] ?? 35),
      tickers: item.tickers, sources: citedSources,
    });

    const thesisNode = nodeId("thesis", id);
    app.repos.graph.upsertNode({
      id: thesisNode, type: "thesis", label: item.summary || item.subject, summary: item.thesis,
      data: { level, subject: item.subject, stance: item.stance, conviction: item.conviction, runId, reportId: report.id },
      status: "active", createdAt: now, updatedAt: now,
    });
    if (level === "sector") app.repos.insightTags.addTag(thesisNode, { dimension: "sector", value: item.subject, source: "ai" }, now);
    if (level === "theme") app.repos.insightTags.addTag(thesisNode, { dimension: "theme", value: item.subject, source: "ai" }, now);
    app.repos.insightTags.addTag(thesisNode, { dimension: "direction", value: stanceDirection(item.stance), source: "ai" }, now);
    app.repos.insightTags.addTag(thesisNode, { dimension: "horizon", value: item.horizon, source: "ai" }, now);
    for (const t of item.tickers) app.repos.insightTags.addTag(thesisNode, { dimension: "ticker", value: t, source: "ai" }, now);
    if (prior[0]) {
      const priorNode = nodeId("thesis", prior[0]);
      app.repos.graph.upsertEdge({ id: edgeId(thesisNode, "supersedes", priorNode), srcId: thesisNode, dstId: priorNode, rel: "supersedes", weight: 1, data: {}, createdAt: now });
    }
    for (const s of citedSources) {
      const srcNode = nodeId("source", s.sourceId);
      app.repos.graph.upsertEdge({ id: edgeId(thesisNode, "cites", srcNode), srcId: thesisNode, dstId: srcNode, rel: "cites", weight: 1, data: {}, createdAt: now });
    }
    added++;
  }
  return { added };
}
