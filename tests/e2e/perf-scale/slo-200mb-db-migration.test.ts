import { describe, expect, it } from "vitest";
import { certifySlo4Migration } from "./ports/migration-200mb.ts";

describe("SLO 4 — 200 MB state.db migration", () => {
  it(
    "slo-200mb-db-migration.test.ts migrates with integrity and cleans temp artifacts",
    () => {
      const result = certifySlo4Migration();
      expect(result.lostRows).toBe(0);
      expect(result.integrityOk).toBe(true);
      expect(result.pass, result.detail.join("; ")).toBe(true);
      expect(result.migrationMs).toBeLessThan(15_000);
      expect(result.peakRamMb).toBeLessThan(400);
    },
    180_000,
  );
});