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
];
