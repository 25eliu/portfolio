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
];
