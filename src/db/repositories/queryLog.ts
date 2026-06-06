import type { DB } from "../connection.ts";
import { QueryLog } from "../../domain/index.ts";

type Row = {
  id: string;
  question: string;
  answer: string;
  tools_used_json: string;
  citations_json: string;
  status: string;
  created_at: string;
};

const toDomain = (r: Row): QueryLog =>
  QueryLog.parse({
    id: r.id,
    question: r.question,
    answer: r.answer,
    toolsUsed: JSON.parse(r.tools_used_json),
    citations: JSON.parse(r.citations_json ?? "[]"),
    status: r.status,
    createdAt: r.created_at,
  });

/** Audit log of grounded NL queries (question → grounded answer + tools used). */
export function queryLogRepo(db: DB) {
  return {
    insert(q: QueryLog): QueryLog {
      const v = QueryLog.parse(q);
      db.query(
        `INSERT INTO query_log (id, question, answer, tools_used_json, citations_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(v.id, v.question, v.answer, JSON.stringify(v.toolsUsed), JSON.stringify(v.citations), v.status, v.createdAt);
      return v;
    },

    listRecent(opts: { limit?: number } = {}): QueryLog[] {
      return db
        .query<Row, [number]>("SELECT * FROM query_log ORDER BY created_at DESC LIMIT ?")
        .all(opts.limit ?? 50)
        .map(toDomain);
    },
  };
}
export type QueryLogRepo = ReturnType<typeof queryLogRepo>;
