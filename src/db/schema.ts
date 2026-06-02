/**
 * Database schema as ordered, idempotent migration steps. Each step runs once, tracked in the
 * `_migrations` table. Keep steps append-only — never edit a shipped step, add a new one.
 */
export const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
  {
    name: "001_init",
    sql: `
      CREATE TABLE portfolios (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        kind            TEXT NOT NULL,
        decision_source TEXT NOT NULL,
        alpaca_account  TEXT,
        created_at      TEXT NOT NULL
      );

      CREATE TABLE holdings (
        id           TEXT PRIMARY KEY,
        portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
        symbol       TEXT NOT NULL,
        shares       REAL NOT NULL,
        cost_basis   REAL,
        UNIQUE (portfolio_id, symbol)
      );
      CREATE INDEX idx_holdings_portfolio ON holdings(portfolio_id);

      CREATE TABLE snapshots (
        id             TEXT PRIMARY KEY,
        portfolio_id   TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
        date           TEXT NOT NULL,
        total_value    REAL NOT NULL,
        cash           REAL NOT NULL,
        positions_json TEXT NOT NULL,
        UNIQUE (portfolio_id, date)
      );
      CREATE INDEX idx_snapshots_portfolio ON snapshots(portfolio_id);

      CREATE TABLE market_snapshots (
        date      TEXT PRIMARY KEY,
        spy_close REAL NOT NULL
      );

      CREATE TABLE reports (
        id                   TEXT PRIMARY KEY,
        date                 TEXT NOT NULL,
        generated_at         TEXT NOT NULL,
        source               TEXT NOT NULL,
        recommendations_json TEXT NOT NULL
      );

      CREATE TABLE runs (
        id          TEXT PRIMARY KEY,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        status      TEXT NOT NULL,
        error       TEXT
      );

      CREATE TABLE risk_profiles (
        portfolio_id TEXT PRIMARY KEY REFERENCES portfolios(id) ON DELETE CASCADE,
        preset       TEXT NOT NULL
      );
    `,
  },
  {
    name: "002_phase2",
    sql: `
      CREATE TABLE fundamentals_cache (
        symbol     TEXT NOT NULL,
        date       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        PRIMARY KEY (symbol, date)
      );

      CREATE TABLE watchlist (
        id     TEXT PRIMARY KEY,
        symbol TEXT NOT NULL UNIQUE,
        note   TEXT
      );
    `,
  },
  {
    name: "003_report_market_context",
    sql: `ALTER TABLE reports ADD COLUMN market_context_json TEXT;`,
  },
  {
    name: "004_portfolio_cash",
    sql: `ALTER TABLE portfolios ADD COLUMN cash REAL NOT NULL DEFAULT 0;`,
  },
  {
    name: "005_schedule",
    sql: `
      CREATE TABLE schedule_settings (
        id            TEXT PRIMARY KEY DEFAULT 'singleton',
        enabled       INTEGER NOT NULL DEFAULT 0,
        time_of_day   TEXT NOT NULL DEFAULT '09:30',
        last_run_date TEXT
      );
    `,
  },
  {
    // Typed journal foundation (roadmap 3A). journal_entries records every recommendation a report
    // produced (scored or not); scored_forecasts captures the complete actionable plans we will later
    // resolve. Both are parallel writes keyed off reports(id) — the reports table is never touched.
    name: "006_journal",
    sql: `
      CREATE TABLE journal_entries (
        id                  TEXT PRIMARY KEY,
        report_id           TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        run_id              TEXT,
        date                TEXT NOT NULL,
        created_at          TEXT NOT NULL,
        ticker              TEXT NOT NULL,
        held                INTEGER NOT NULL,
        action              TEXT NOT NULL,
        conviction          REAL NOT NULL,
        strategy_family     TEXT NOT NULL,
        recommendation_json TEXT NOT NULL,
        market_context_id   TEXT,
        scored              INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_journal_ticker ON journal_entries(ticker);
      CREATE INDEX idx_journal_date ON journal_entries(date);
      CREATE INDEX idx_journal_report ON journal_entries(report_id);

      CREATE TABLE scored_forecasts (
        id                        TEXT PRIMARY KEY,
        journal_entry_id          TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        ticker                    TEXT NOT NULL,
        side                      TEXT NOT NULL,
        strategy_family           TEXT NOT NULL,
        signals_json              TEXT NOT NULL,
        created_at                TEXT NOT NULL,
        as_of_timestamp           TEXT NOT NULL,
        market_session            TEXT NOT NULL,
        quote_timestamp           TEXT,
        price_feed                TEXT NOT NULL,
        reference_price           REAL NOT NULL,
        entry                     REAL,
        target                    REAL NOT NULL,
        stop                      REAL NOT NULL,
        horizon_trading_sessions  INTEGER NOT NULL,
        resolve_at                TEXT NOT NULL,
        conviction                REAL NOT NULL,
        benchmark_symbol          TEXT NOT NULL DEFAULT 'SPY',
        benchmark_reference_price REAL,
        resolution_policy_version TEXT NOT NULL DEFAULT 'v1',
        market_context_id         TEXT,
        cited_source_ids_json     TEXT NOT NULL DEFAULT '[]',
        retrieved_chunk_ids_json  TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX idx_forecast_ticker ON scored_forecasts(ticker);
      CREATE INDEX idx_forecast_resolve_at ON scored_forecasts(resolve_at);
      CREATE INDEX idx_forecast_journal ON scored_forecasts(journal_entry_id);
    `,
  },
  {
    // Forecast resolution (roadmap 3D). Each scored forecast resolves to exactly one outcome once its
    // horizon elapses, graded against historical daily high/low bars. Outcomes are immutable and never
    // rewritten when a provider or policy changes — the policy versions are recorded on every row.
    name: "007_forecast_outcomes",
    sql: `
      CREATE TABLE forecast_outcomes (
        id                        TEXT PRIMARY KEY,
        forecast_id               TEXT NOT NULL UNIQUE REFERENCES scored_forecasts(id) ON DELETE CASCADE,
        ticker                    TEXT NOT NULL,
        outcome                   TEXT NOT NULL,
        resolved_at               TEXT NOT NULL,
        resolution_date           TEXT NOT NULL,
        entry_price               REAL NOT NULL,
        exit_price                REAL NOT NULL,
        terminal_return           REAL NOT NULL,
        spy_excess_return         REAL,
        max_favorable_excursion   REAL NOT NULL,
        max_adverse_excursion     REAL NOT NULL,
        forecast_r                REAL,
        bars_provider             TEXT NOT NULL,
        adjustment_policy_version TEXT NOT NULL,
        resolution_policy_version TEXT NOT NULL,
        warnings_json             TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX idx_outcome_resolution_date ON forecast_outcomes(resolution_date);
    `,
  },
  {
    // Research knowledge base (roadmap 3C). User uploads / URL snapshots / private notes become
    // immutable, hashed versions of sanitized text chunks, lexically retrievable via FTS5 and injected
    // into the LLM's research stage as cited, untrusted evidence. recommendation_evidence records the
    // exact chunks each recommendation used, for reproducibility.
    name: "008_knowledge",
    sql: `
      CREATE TABLE knowledge_sources (
        id               TEXT PRIMARY KEY,
        kind             TEXT NOT NULL,           -- upload | url | note
        title            TEXT NOT NULL,
        trust_class      TEXT NOT NULL,           -- public_url | public_upload | private_note | system_lesson
        scope            TEXT NOT NULL,           -- global | ticker
        scope_ticker     TEXT,                    -- set when scope = ticker
        use_in_analysis  INTEGER NOT NULL DEFAULT 1,  -- private notes default 0 (explicit opt-in)
        status           TEXT NOT NULL DEFAULT 'active', -- active | quarantined | archived
        origin           TEXT,                    -- filename or URL
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX idx_ksource_status ON knowledge_sources(status);
      CREATE INDEX idx_ksource_scope_ticker ON knowledge_sources(scope_ticker);

      CREATE TABLE knowledge_versions (
        id           TEXT PRIMARY KEY,
        source_id    TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        version      INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        char_count   INTEGER NOT NULL,
        raw_path     TEXT,
        created_at   TEXT NOT NULL,
        UNIQUE (source_id, version)
      );

      CREATE TABLE knowledge_chunks (
        id          TEXT PRIMARY KEY,
        source_id   TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        version_id  TEXT NOT NULL REFERENCES knowledge_versions(id) ON DELETE CASCADE,
        ordinal     INTEGER NOT NULL,
        text        TEXT NOT NULL,
        char_count  INTEGER NOT NULL,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_kchunk_source ON knowledge_chunks(source_id);
      CREATE INDEX idx_kchunk_active ON knowledge_chunks(active);

      CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(chunk_id UNINDEXED, text);

      CREATE TABLE knowledge_ingestion_runs (
        id            TEXT PRIMARY KEY,
        source_id     TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
        version_id    TEXT,
        status        TEXT NOT NULL,             -- ok | quarantined | failed
        warnings_json TEXT NOT NULL DEFAULT '[]',
        reason        TEXT,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_kingest_source ON knowledge_ingestion_runs(source_id);

      CREATE TABLE recommendation_evidence (
        id               TEXT PRIMARY KEY,
        journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        chunk_id         TEXT NOT NULL,           -- not FK: provenance survives source archival
        source_id        TEXT NOT NULL,
        rank             INTEGER NOT NULL,
        created_at       TEXT NOT NULL
      );
      CREATE INDEX idx_recev_journal ON recommendation_evidence(journal_entry_id);
    `,
  },
  {
    // Knowledge graph (the connective substrate shared by the research library and the performance
    // wiki). Atomic canonical nodes with stable slug ids (e.g. "ticker:AAPL", "theme:ai-datacenter",
    // "lesson:..."), connected by typed, deduplicated, bidirectionally-queryable edges. This is what
    // makes the knowledge well-connected and traversable, and what the LLM briefing is compiled from.
    name: "009_knowledge_graph",
    sql: `
      CREATE TABLE kg_nodes (
        id         TEXT PRIMARY KEY,             -- stable slug, e.g. "ticker:AAPL"
        type       TEXT NOT NULL,                -- ticker | sector | theme | catalyst | concept | strategy_family | signal | source | lesson | metric | cohort
        label      TEXT NOT NULL,
        summary    TEXT NOT NULL DEFAULT '',
        data_json  TEXT NOT NULL DEFAULT '{}',
        status     TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_kgnode_type ON kg_nodes(type);

      CREATE TABLE kg_edges (
        id         TEXT PRIMARY KEY,             -- stable slug "src|rel|dst"
        src_id     TEXT NOT NULL,
        dst_id     TEXT NOT NULL,
        rel        TEXT NOT NULL,                -- tagged_with | mentions | cites | derived_from | supports | contradicts | belongs_to | supersedes | related_to | in_cohort
        weight     REAL NOT NULL DEFAULT 1,
        data_json  TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE (src_id, rel, dst_id)
      );
      CREATE INDEX idx_kgedge_src ON kg_edges(src_id);
      CREATE INDEX idx_kgedge_dst ON kg_edges(dst_id);
      CREATE INDEX idx_kgedge_rel ON kg_edges(rel);
    `,
  },
  {
    // Performance wiki (roadmap §9, Phase 4). Deterministic cohort metrics computed from resolved
    // forecast outcomes, evidence-gated prose lessons compiled strictly from those metrics, and dated
    // briefings (the compact, versioned context injected into future analysis). Nothing here is the
    // model grading itself: facts are computed first, prose only summarizes computed facts.
    name: "010_wiki",
    sql: `
      CREATE TABLE wiki_metrics (
        id                        TEXT PRIMARY KEY,   -- "<window>:<cohort_key>"
        cohort_kind               TEXT NOT NULL,      -- overall | strategy_family | side | horizon | confidence_bucket
        cohort_key                TEXT NOT NULL,
        window                    TEXT NOT NULL,      -- all_time | rolling_90d
        n                         INTEGER NOT NULL,
        hit_rate                  REAL,
        expectancy_r              REAL,
        avg_terminal_return       REAL,
        avg_spy_excess            REAL,
        brier                     REAL,
        coverage                  REAL,
        sample_forecast_ids_json  TEXT NOT NULL DEFAULT '[]',
        computed_at               TEXT NOT NULL,
        resolution_policy_version TEXT NOT NULL
      );
      CREATE INDEX idx_wmetric_cohort ON wiki_metrics(cohort_kind);

      CREATE TABLE wiki_lessons (
        id                       TEXT PRIMARY KEY,    -- "<window>:<cohort_key>"
        title                    TEXT NOT NULL,
        body                     TEXT NOT NULL,
        state                    TEXT NOT NULL,       -- draft | provisional | active | superseded | expired | rejected
        cohort_kind              TEXT NOT NULL,
        cohort_key               TEXT NOT NULL,
        window                   TEXT NOT NULL,
        n                        INTEGER NOT NULL,
        date_window_start        TEXT,
        date_window_end          TEXT,
        source_forecast_ids_json TEXT NOT NULL DEFAULT '[]',
        freshness_deadline       TEXT,
        metrics_json             TEXT NOT NULL DEFAULT '{}',
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );
      CREATE INDEX idx_wlesson_state ON wiki_lessons(state);

      CREATE TABLE briefings (
        id                      TEXT PRIMARY KEY,
        date                    TEXT NOT NULL,
        body                    TEXT NOT NULL,
        included_lesson_ids_json TEXT NOT NULL DEFAULT '[]',
        included_metric_ids_json TEXT NOT NULL DEFAULT '[]',
        created_at              TEXT NOT NULL
      );
      CREATE INDEX idx_briefing_date ON briefings(date);
    `,
  },
  {
    // Calibration: mean stated conviction per cohort, so the wiki can report stated-vs-realized
    // (conviction vs hit-rate) as a descriptive statistic — the highest-signal honesty check.
    name: "011_wiki_metric_conviction",
    sql: `ALTER TABLE wiki_metrics ADD COLUMN avg_conviction REAL;`,
  },
  {
    // Guarded AI paper trading (roadmap 3B / §6,§7). The AI autonomously manages its own paper book:
    // execution_settings holds the auto-execute toggle + the seed baseline (capital matched to the
    // user's portfolio total); trade_decisions is the auditable log — every proposed/skipped/submitted/
    // filled/failed order with a reason, linked back to the journal entry + scored forecast it came from.
    // PAPER ONLY: orders are submitted exclusively through the paper gateway (guarded at run time).
    name: "012_execution",
    sql: `
      CREATE TABLE execution_settings (
        id               TEXT PRIMARY KEY DEFAULT 'singleton',
        auto_execute     INTEGER NOT NULL DEFAULT 1,
        baseline_capital REAL,
        seeded_at        TEXT,
        updated_at       TEXT NOT NULL
      );

      CREATE TABLE trade_decisions (
        id               TEXT PRIMARY KEY,
        run_id           TEXT,
        journal_entry_id TEXT,
        forecast_id      TEXT,
        ticker           TEXT NOT NULL,
        side             TEXT NOT NULL,            -- buy | sell
        action           TEXT NOT NULL,            -- BUY | ADD | TRIM | SELL
        qty              REAL NOT NULL,
        intended_price   REAL NOT NULL,
        notional         REAL NOT NULL,
        status           TEXT NOT NULL,            -- proposed | skipped | submitted | filled | failed
        reason           TEXT,
        broker_order_id  TEXT,
        created_at       TEXT NOT NULL,
        submitted_at     TEXT
      );
      CREATE INDEX idx_trade_run ON trade_decisions(run_id);
      CREATE INDEX idx_trade_ticker ON trade_decisions(ticker);
      CREATE INDEX idx_trade_status ON trade_decisions(status);
    `,
  },
  {
    // Buy date per manual holding, so My Portfolio can show "since <date>" and cost-based P&L.
    name: "013_holding_acquired_at",
    sql: `ALTER TABLE holdings ADD COLUMN acquired_at TEXT;`,
  },
  {
    // The AI is now a self-contained, always-on DB-backed paper book (starts at $100k, sizes off its
    // own compounding equity, fills against its own holdings/cash). The seed-baseline + auto-execute
    // toggle in execution_settings are gone — there's nothing left to configure. trade_decisions (the
    // auditable log) stays.
    name: "014_drop_execution_settings",
    sql: `DROP TABLE IF EXISTS execution_settings;`,
  },
  {
    // Grounded NL query (roadmap Phase 5). An audit log of every "ask your portfolio anything" Q&A:
    // the question, the grounded answer, and which read-only tools the model called to produce it.
    name: "015_query_log",
    sql: `
      CREATE TABLE query_log (
        id              TEXT PRIMARY KEY,
        question        TEXT NOT NULL,
        answer          TEXT NOT NULL,
        tools_used_json TEXT NOT NULL DEFAULT '[]',
        status          TEXT NOT NULL DEFAULT 'ok',
        created_at      TEXT NOT NULL
      );
      CREATE INDEX idx_query_log_created ON query_log(created_at);
    `,
  },
];
