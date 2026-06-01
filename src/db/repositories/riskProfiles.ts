import type { DB } from "../connection.ts";
import { RiskProfile, type RiskPreset } from "../../domain/index.ts";

type Row = { portfolio_id: string; preset: string };

const toDomain = (r: Row): RiskProfile =>
  RiskProfile.parse({ portfolioId: r.portfolio_id, preset: r.preset });

export function riskProfilesRepo(db: DB) {
  return {
    get(portfolioId: string): RiskProfile | null {
      const row = db
        .query<Row, [string]>("SELECT * FROM risk_profiles WHERE portfolio_id = ?")
        .get(portfolioId);
      return row ? toDomain(row) : null;
    },

    set(portfolioId: string, preset: RiskPreset): RiskProfile {
      const valid = RiskProfile.parse({ portfolioId, preset });
      db.query(
        `INSERT INTO risk_profiles (portfolio_id, preset) VALUES (?, ?)
         ON CONFLICT (portfolio_id) DO UPDATE SET preset = excluded.preset`,
      ).run(valid.portfolioId, valid.preset);
      return valid;
    },
  };
}
export type RiskProfilesRepo = ReturnType<typeof riskProfilesRepo>;
