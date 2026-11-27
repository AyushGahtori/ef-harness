import { describe, expect, it } from "vitest";
import {
  FeatureJourneyGate,
  VacuousSealedCheckError,
  executeSeamJourney,
  mountFromPlan,
  runBoundedFixLoop,
} from "../../src/feature-integrator/index.js";
import type { CodeSnapshot, JourneyReport, RouteMount, SealedCheck } from "../../src/feature-integrator/index.js";
import { wiringNeed } from "./git-fixture.js";

function snapshot(label: "base" | "feature", files: Record<string, string>): CodeSnapshot {
  return { label, commit: label, files: new Map(Object.entries(files)) };
}

function emptyReport(ok: boolean, repair: JourneyReport["hint"]): JourneyReport {
  return {
    ok,
    redBeforeGreen: [],
    seamFailures: [],
    viewportFailures: [],
    auditFindings: [],
    hint: repair,
  };
}

describe("FeatureJourneyGate", () => {
  const gate = new FeatureJourneyGate();
  const sealed: SealedCheck = {
    id: "sealed-menu",
    run(snapshot) {
      const pass = (snapshot.files.get("src/routes.ts") ?? "").includes('"/api/menu-items"');
      return { pass, observed: pass ? "mounted" : "missing" };
    },
  };

  it("proves red-before-green and rejects a sealed check that already passes on the base", async () => {
    const base = snapshot("base", {});
    const feature = snapshot("feature", { "src/routes.ts": 'export const routes = [{ path: "/api/menu-items" }];\n' });
    const report = await gate.evaluate({
      base,
      feature,
      sealedChecks: [sealed],
      mounts: [],
      journeys: [],
      viewportChecks: [],
      auditFiles: [],
    });
    expect(report.ok).toBe(true);
    expect(report.redBeforeGreen).toEqual([
      { checkId: "sealed-menu", basePassed: false, featurePassed: true },
    ]);

    const vacuous: SealedCheck = { id: "sealed-vacuous", run: () => ({ pass: true, observed: "always" }) };
    await expect(
      gate.evaluate({
        base,
        feature,
        sealedChecks: [vacuous],
        mounts: [],
        journeys: [],
        viewportChecks: [],
        auditFiles: [],
      }),
    ).rejects.toThrow(VacuousSealedCheckError);
    try {
      await gate.evaluate({
        base,
        feature,
        sealedChecks: [vacuous],
        mounts: [],
        journeys: [],
        viewportChecks: [],
        auditFiles: [],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(VacuousSealedCheckError);
      expect((error as VacuousSealedCheckError).code).toBe("already_green_on_base");
    }
  });

  it("pinpoints a cross-leaf route mismatch and can repair it", async () => {
    const mounts: RouteMount[] = [
      mountFromPlan({
        method: "GET",
        path: "/api/menu",
        taskId: "T-Menu",
        effects: null,
      }),
    ];
    const failure = executeSeamJourney(mounts, {
      id: "journey-order",
      templateId: "S-02",
      steps: [
        {
          kind: "http",
          method: "GET",
          path: "/api/menu-items",
          expectStatus: 200,
          expectingTask: "T-Order",
          body: null,
          expectBodyIncludes: null,
        },
      ],
    });
    expect(failure?.detail).toBe("T-Order expects /api/menu-items while T-Menu mounted /api/menu");
    const report = await gate.evaluate({
      base: snapshot("base", {}),
      feature: snapshot("feature", { "src/routes.ts": 'export const routes = [{ path: "/api/menu-items" }];\n' }),
      sealedChecks: [sealed],
      mounts,
      journeys: [
        {
          id: "journey-order",
          templateId: "S-02",
          steps: [
            {
              kind: "http",
              method: "GET",
              path: "/api/menu-items",
              expectStatus: 200,
              expectingTask: "T-Order",
              body: null,
              expectBodyIncludes: null,
            },
          ],
        },
      ],
      viewportChecks: [],
      auditFiles: [],
    });
    expect(report.ok).toBe(false);
    expect(report.hint?.repair).toEqual({ fromPath: "/api/menu", toPath: "/api/menu-items" });
  });

  it("runs a local API, database, and mailbox seam plus both viewports", async () => {
    const mounts = [
      mountFromPlan({
        method: "POST",
        path: "/api/orders",
        taskId: "T-Order",
        effects: wiringNeed({
          kind: "api",
          path: "/api/orders",
          taskId: "T-Order",
          effects: {
            dbKey: "order:1",
            dbValue: "soup",
            mailTo: "kitchen@example.test",
            mailSubject: "Order placed",
            mailBody: "two soups",
          },
        }).effects,
      }),
    ];
    expect(
      executeSeamJourney(mounts, {
        id: "journey-order-mail",
        templateId: "S-06",
        steps: [
          {
            kind: "http",
            method: "POST",
            path: "/api/orders",
            expectStatus: 200,
            expectingTask: "T-Order",
            body: { qty: 2 },
            expectBodyIncludes: "/api/orders",
          },
          { kind: "db", key: "order:1", expectValue: "soup" },
          { kind: "mail", expectSubjectIncludes: "Order placed" },
        ],
      }),
    ).toBeNull();

    const report = await gate.evaluate({
      base: snapshot("base", {}),
      feature: snapshot("feature", { "src/routes.ts": 'export const routes = [{ path: "/api/menu-items" }];\n' }),
      sealedChecks: [sealed],
      mounts: [],
      journeys: [],
      viewportChecks: [
        { id: "mobile", width: 375, render: () => ({ text: "Menu", overflow: false, tapTargetPx: 48 }) },
        { id: "desktop", width: 1440, render: () => ({ text: "Menu", overflow: false, tapTargetPx: 48 }) },
      ],
      auditFiles: [{ path: "src/routes.ts", text: 'export const routes = [];\n' }],
    });
    expect(report.ok).toBe(true);
  });

  it("stops after two fix rounds", async () => {
    let evaluations = 0;
    const looping = await runBoundedFixLoop({
      initial: 0,
      evaluate: () => {
        evaluations += 1;
        return emptyReport(false, {
          round: 0,
          target: "seam",
          detail: "still broken",
          repair: { fromPath: "/api/menu", toPath: "/api/menu-item" },
        });
      },
      apply: (state) => state + 1,
    });
    expect(looping.hints).toHaveLength(2);
    expect(looping.hints.map((hint) => hint.round)).toEqual([1, 2]);
    expect(looping.report.ok).toBe(false);
    expect(evaluations).toBe(3);

    const once = await runBoundedFixLoop({
      initial: 0,
      evaluate: (state) =>
        emptyReport(state === 1, state === 1
          ? null
          : { round: 0, target: "wiring", detail: "missing mount", repair: { fromPath: "/a", toPath: "/b" } }),
      apply: () => 1,
    });
    expect(once.report.ok).toBe(true);
    expect(once.hints).toHaveLength(1);
  });
});
