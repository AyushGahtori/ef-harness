import { expect, it } from "vitest";
import { runSecurityAudit } from "./runner.ts";

it("passes the offline five-pillar security certification audit", async () => {
  const report = await runSecurityAudit();
  expect(report.exitCode).toBe(0);
  expect(report.claimedCertification).toBe(true);
  expect(report.findings).toEqual([]);
  expect(report.pillars).toHaveLength(5);
  expect(report.pillars.every((pillar) => pillar.passed)).toBe(true);
  expect(report.redTeam.every((row) => row.blocked)).toBe(true);
  expect(report.residualSecretBytes).toBe(0);
  expect(report.silentSpendMicroUsd).toBe(0);
  expect(report.withdrawnVendorHits).toBe(0);
  expect(report.skillPinsOk).toBe(true);
  expect(report.allowBuildsOk).toBe(true);
  expect(report.signature.startsWith("sha256:")).toBe(true);
  expect(report.hostElapsedMs).toBeLessThan(60_000);
}, 60_000);

it("fails closed on residual secrets, weak electron policy, or silent spend", async () => {
  const residual = await runSecurityAudit({ faults: { skipVacuum: true } });
  expect(residual.exitCode).toBe(1);
  expect(residual.findings).toContain("pillar1-residual-bytes");
  const electron = await runSecurityAudit({ faults: { weakElectronCsp: true } });
  expect(electron.exitCode).toBe(1);
  expect(electron.findings).toContain("pillar2-electron");
  const spend = await runSecurityAudit({ faults: { silentPaidMicroUsd: 250_000 } });
  expect(spend.exitCode).toBe(1);
  expect(spend.findings).toContain("pillar4-silent-spend");
  const chain = await runSecurityAudit({ faults: { skillHashDrift: true } });
  expect(chain.exitCode).toBe(1);
  expect(chain.findings).toContain("pillar3-skill-sha256");
});