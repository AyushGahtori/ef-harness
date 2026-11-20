import fs from "node:fs";
import { expect, it } from "vitest";
import { certifyCi, reportPath } from "../m1-exit-gate/run-m1-suite.ts";
import { runLiveCertification } from "../m1-exit-gate/pipeline.ts";

it("certifies the deterministic M1 kitchen exit gate", async () => {
  const certified = await certifyCi();
  expect(certified.result.accepted).toBe(20);
  expect(certified.result.adversarial.every((item) => item.accepted === false)).toBe(true);
  expect(certified.result.redTeam.escapes).toBe(0);
  expect(certified.report).toContain("## Deterministic CI");
  expect(certified.report).toContain("## Live LLM certification");
  expect(certified.report).toContain("Stub block rate: 100%");
  expect(certified.report).toContain("Red-team escapes: 0/7");
  expect(certified.report).toContain("Claimed M1 live bar (>= 17/20): no");
  expect(certified.report.includes("HK-")).toBe(false);
  expect(fs.readFileSync(reportPath(), "utf8")).toBe(certified.report);
}, 180_000);

it("does not claim the live M1 bar without an API key", async () => {
  const liveKey = process.env.EF_M1_LIVE_API_KEY;
  const routerKey = process.env.OPENROUTER_API_KEY;
  delete process.env.EF_M1_LIVE_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const live = await runLiveCertification();
    expect(live.ran).toBe(false);
    expect(live.claimedCertification).toBe(false);
    expect(live.accepted).toBeNull();
  } finally {
    if (liveKey !== undefined) process.env.EF_M1_LIVE_API_KEY = liveKey;
    if (routerKey !== undefined) process.env.OPENROUTER_API_KEY = routerKey;
  }
});
