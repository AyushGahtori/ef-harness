import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openProjectStateDb } from "@ef-harness/db";
import { DiscoverySessionCoordinator } from "../../src/session/index.js";
import type { DepthCatalogEntry, ProjectStage } from "../../src/depth/types.js";

const closers: Array<() => Promise<void> | void> = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("discovery session coordinator", () => {
  it("delegates recommendations, keeps observed criteria out of the next batch, and counts bases exactly", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-c28-discovery-"));
    dirs.push(rootDir);
    const stateDb = openProjectStateDb({ projectId: "C28Discovery", rootDir });
    const coordinator = new DiscoverySessionCoordinator({ stateDb, now: () => 1_700_000_000_000 });
    closers.unshift(async () => {
      await coordinator.close();
      if (!stateDb.isClosed()) stateDb.close();
    });

    const started = coordinator.startSession({
      workItemId: "W-lunch",
      title: "Friday lunch list",
      stage: "prototype",
      catalog: [
        entry("storage.engine", "Where do lunch totals live?", "sqlite", false),
        entry("notification.channel", "How does the kitchen hear about a new order?", "email", false),
        entry("auth.roles", "Who can change an order?", "staff_only", true),
        entry("repo.layout", "Which repository already holds the product?", "existing_web_repo", false),
      ],
    });
    expect(started.stage).toBe("prototype");
    expect(started.criterionIds).toEqual([
      "storage.engine",
      "notification.channel",
      "auth.roles",
      "repo.layout",
    ]);

    const ingested = coordinator.ingestUserTurn({
      workItemId: "W-lunch",
      opId: "opening-1",
      text: "Staff submit lunch choices and the kitchen sees totals grouped by dish.",
    });
    expect(ingested.openingPromptId).toBe("opening.1");
    expect(ingested.chunkCount).toBe(1);
    expect(ingested.askedCriterionIds).toContain("repo.layout");

    const observed = coordinator.preSettleObservedCriteria({
      workItemId: "W-lunch",
      settlements: [{ criterionId: "repo.layout", value: "existing_web_repo" }],
    });
    expect(observed.settledCriterionIds).toEqual(["repo.layout"]);
    expect(observed.askedCriterionIds).not.toContain("repo.layout");

    const again = coordinator.preSettleObservedCriteria({
      workItemId: "W-lunch",
      settlements: [{ criterionId: "repo.layout", value: "existing_web_repo" }],
    });
    expect(again.settledCriterionIds).toEqual([]);
    expect(again.skippedCriterionIds).toEqual(["repo.layout"]);

    const delegated = coordinator.acceptRecommendedDefaults({ workItemId: "W-lunch", scope: "open" });
    expect(delegated.delegatedCriterionIds).toEqual(["notification.channel", "storage.engine"]);
    expect(delegated.held.map((item) => item.criterionId)).toEqual(["auth.roles"]);
    expect(delegated.skippedSettled).toEqual([]);

    const snapshot = coordinator.getReadinessSnapshot("W-lunch");
    expect(snapshot).toEqual({
      explicitCount: 0,
      confirmedCount: 0,
      delegatedChosenForYouCount: 2,
      observedCount: 1,
      blockingUnsettledCount: 1,
      deferredCount: 0,
      readyToPlan: false,
    });

    const stored = stateDb.writer
      .prepare("SELECT fields FROM nodes WHERE id = :id")
      .get({ id: "decision:W-lunch:storage.engine" }) as { fields: string };
    const fields = JSON.parse(stored.fields) as { basis: string; selectedOptionId: string; criterionId: string };
    expect(fields.basis).toBe("delegated");
    expect(fields.selectedOptionId).toBe("sqlite");
    expect(fields.criterionId).toBe("storage.engine");
  });
});

function entry(
  criterionId: string,
  label: string,
  optionId: string,
  mustAsk: boolean,
): DepthCatalogEntry {
  const stages: Record<ProjectStage, boolean> = { prototype: true, mvp: true, production: true };
  return {
    criterionId,
    label,
    riskTier: "low",
    reworkCost: "easy",
    downstreamTaskCount: 0,
    options: [
      { id: optionId, label: optionId },
      { id: "other", label: "Other" },
    ],
    recommendations: [
      { stage: "prototype", optionId, rationale: "Prototype recommendation.", safeForLowerStage: true },
      { stage: "mvp", optionId, rationale: "MVP recommendation.", safeForLowerStage: true },
      { stage: "production", optionId, rationale: "Production recommendation.", safeForLowerStage: false },
    ],
    stageApplicability: stages,
    strongConventionStages: ["prototype", "mvp"],
    evidenceSettled: false,
    mustAskClass: mustAsk ? "authentication_roles" : null,
    domain: "general",
    deploymentObvious: false,
    materialOptionDifference: false,
    conflict: false,
    highRiskSpecExpander: false,
    ambiguousBrownfield: false,
  };
}
