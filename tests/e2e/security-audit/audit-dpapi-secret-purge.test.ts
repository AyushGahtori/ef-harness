import { expect, it } from "vitest";
import { runSecurityAudit } from "./runner.ts";

it("pillar 1 — DPAPI vault isolation & 8-step secret purge raw-byte proof", async () => {
  const report = await runSecurityAudit();
  const pillar = report.pillars.find((row) => row.pillar === 1);
  expect(pillar?.passed).toBe(true);
  expect(pillar?.evidence).toContain("eight-step-purge");
  expect(pillar?.evidence).toContain("raw-byte-zero");
  expect(report.residualSecretBytes).toBe(0);
});