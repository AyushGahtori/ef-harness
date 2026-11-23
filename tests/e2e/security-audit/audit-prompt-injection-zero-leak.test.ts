import { expect, it } from "vitest";
import { RED_TEAM_VECTORS } from "./constants.ts";
import { RedTeamSecuritySuiteRunner, runRedTeamGate } from "./ports/red-team.ts";
import { auditElectronProfiles } from "./ports/electron-audit.ts";

it("pillar 2 — red-team & prompt-injection zero-leak certification", async () => {
  const runner = new RedTeamSecuritySuiteRunner();
  const rows = await runner.runAll();
  expect(rows).toHaveLength(RED_TEAM_VECTORS.length);
  expect(runRedTeamGate(rows).ok).toBe(true);
  const electron = auditElectronProfiles();
  expect(electron.ok).toBe(true);
  expect(electron.profiles.every((row) => row.sandbox && row.contextIsolation)).toBe(true);
});