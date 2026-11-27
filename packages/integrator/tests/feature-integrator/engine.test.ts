import { describe, expect, it as vitestIt } from "vitest";

const it = (name: string, fn: () => void): void => {
  vitestIt(name, fn, 120_000);
};
import {
  FeatureDoneRefusedError,
  FeatureIntegratorEngine,
  FeatureNotReadyError,
  INTEGRATION_REF,
  InMemoryFeatureLifecycle,
  StaleEpochError,
  VacuousSealedCheckError,
  createGitRefCas,
  featureRef,
  parseEfTrailers,
} from "../../src/feature-integrator/index.js";
import type {
  FeatureIntegrationRequest,
  LeafCommitInput,
  SealedCheck,
  ViewportCheck,
} from "../../src/feature-integrator/index.js";
import { commitMessage, commitParents, revParse } from "../../src/feature-integrator/git.js";
import { gitOk } from "../../src/feature-integrator/git.js";
import { commitAll, initRepo, pointRef, removeRepo, wiringNeed } from "./git-fixture.js";

function viewports(): ViewportCheck[] {
  return [
    { id: "ui-mobile", width: 375, render: () => ({ text: "Menu", overflow: false, tapTargetPx: 48 }) },
    { id: "ui-desktop", width: 1440, render: () => ({ text: "Menu", overflow: false, tapTargetPx: 48 }) },
  ];
}

function leafFile(name: string): string {
  return `export const ${name} = ${JSON.stringify(name)};\n`;
}

function prepare(featureId: string, files: { taskId: string; path: string; text: string; scope: string; need: LeafCommitInput["wiringNeeds"][number] }[]) {
  const repo = initRepo();
  const base = commitAll(repo, "main", { "README.md": "base\n" }, "base");
  pointRef(repo, INTEGRATION_REF, base);
  pointRef(repo, featureRef(featureId), base);
  const leaves: LeafCommitInput[] = files.map((file) => {
    const sha = commitAll(repo, file.taskId, { [file.path]: file.text }, file.taskId, base);
    return {
      taskId: file.taskId,
      sha,
      objective: `Deliver ${file.taskId}`,
      requirementIds: [`R-${file.taskId}`],
      checkIds: [`AC-${file.taskId}`],
      writeScope: [file.scope],
      wiringNeeds: [file.need],
    };
  });
  const lifecycle = new InMemoryFeatureLifecycle();
  lifecycle.init(featureId, 3);
  return { repo, base, leaves, lifecycle };
}

function request(
  prepared: ReturnType<typeof prepare>,
  featureId: string,
  overrides: Partial<FeatureIntegrationRequest> = {},
): FeatureIntegrationRequest {
  const sealed: SealedCheck = {
    id: "sealed-routes",
    run(snapshot) {
      const text = snapshot.files.get("src/routes.ts") ?? "";
      const pass = text.includes('"/menu"') && text.includes('"/orders"');
      return { pass, observed: pass ? "wired" : "missing" };
    },
  };
  return {
    repoPath: prepared.repo,
    featureId,
    expectedEpoch: 3,
    holder: "feature-author",
    mode: "m2_sequential",
    history: "squash",
    harnessVersion: "0.0.0",
    leaves: prepared.leaves,
    sealedChecks: [sealed],
    seamJourneys: [
      {
        id: "journey-shop",
        templateId: "S-02",
        steps: [
          {
            kind: "http",
            method: "GET",
            path: "/menu",
            expectStatus: 200,
            expectingTask: "T-Order",
            body: null,
            expectBodyIncludes: null,
          },
          {
            kind: "http",
            method: "GET",
            path: "/orders",
            expectStatus: 200,
            expectingTask: "T-Menu",
            body: null,
            expectBodyIncludes: null,
          },
        ],
      },
    ],
    viewportChecks: viewports(),
    requirements: [
      { id: "R-T-Menu", checkStatus: "pass", waiverApproved: false },
      { id: "R-T-Order", checkStatus: "pass", waiverApproved: false },
    ],
    tasks: [],
    earlierRegressions: [],
    openContractChangeRequestIds: [],
    accessibilityClean: true,
    layoutClean: true,
    lifecycle: prepared.lifecycle,
    ...overrides,
  };
}

function shopLeaves(): Parameters<typeof prepare>[1] {
  return [
    {
      taskId: "T-Menu",
      path: "src/features/menu/menu.ts",
      text: leafFile("menu"),
      scope: "src/features/menu/**",
      need: wiringNeed({ kind: "route", path: "/menu", taskId: "T-Menu", component: "MenuPage" }),
    },
    {
      taskId: "T-Order",
      path: "src/features/order/order.ts",
      text: leafFile("order"),
      scope: "src/features/order/**",
      need: wiringNeed({ kind: "route", path: "/orders", taskId: "T-Order", component: "OrdersPage" }),
    },
  ];
}

describe("FeatureIntegratorEngine", () => {
  it("squashes a wired feature with EF trailers and reaches DONE only when all 7 conditions hold", async () => {
    const prepared = prepare("F-Menu", shopLeaves());
    try {
      const result = await new FeatureIntegratorEngine().integrate(request(prepared, "F-Menu"));
      expect(result.status).toBe("done");
      expect(result.featureState).toBe("DONE");
      expect(result.phase).toBe("INTEGRATING");
      expect(result.wiringTaskId).toBe("wiring-F-Menu");
      expect(prepared.lifecycle.read("F-Menu").state).toBe("DONE");
      expect(result.commitSha).toBeTruthy();
      expect(revParse(prepared.repo, INTEGRATION_REF)).toBe(result.integrationSha);
      const message = commitMessage(prepared.repo, result.commitSha ?? "");
      const trailers = parseEfTrailers(message);
      expect(trailers).toEqual({
        feature: "F-Menu",
        tasks: ["T-Menu", "T-Order"],
        requirements: ["R-T-Menu", "R-T-Order"],
        checksPassed: result.trailers?.checksPassed,
        harnessVersion: "0.0.0",
      });
      expect(trailers?.checksPassed).toMatch(/^[0-9a-f]{64}$/);
      expect(commitParents(prepared.repo, result.commitSha ?? "")).toEqual([prepared.base]);
      expect(result.output).toMatchObject({ wiring_done: ["wiring-F-Menu"] });
      expect(result.redBeforeGreen[0]).toEqual({
        checkId: "sealed-routes",
        basePassed: false,
        featurePassed: true,
      });
    } finally {
      removeRepo(prepared.repo);
    }
  });

  it("preserves logical history when configured and still stamps the tip commit", async () => {
    const prepared = prepare("F-Menu", shopLeaves());
    try {
      const result = await new FeatureIntegratorEngine().integrate(
        request(prepared, "F-Menu", { history: "preserve" }),
      );
      expect(result.status).toBe("done");
      const count = gitOk({
        repo: prepared.repo,
        args: ["rev-list", "--count", `${prepared.base}..${featureRef("F-Menu")}`],
      }).stdout.trim();
      expect(Number(count)).toBeGreaterThan(1);
      expect(parseEfTrailers(commitMessage(prepared.repo, result.commitSha ?? ""))?.feature).toBe("F-Menu");
    } finally {
      removeRepo(prepared.repo);
    }
  });

  it("queues two features on isolated branches without moving harness/integration", async () => {
    const first = prepare("F-A", shopLeaves());
    const second = prepare("F-B", shopLeaves());
    try {
      const engine = new FeatureIntegratorEngine();
      const left = await engine.integrate(request(first, "F-A", { mode: "m3_queue" }));
      const right = await engine.integrate(request(second, "F-B", { mode: "m3_queue" }));
      expect(left.status).toBe("queued_for_merge");
      expect(right.status).toBe("queued_for_merge");
      expect(left.queueHandoff?.target).toBe("Task 111");
      expect(right.queueHandoff?.featureRef).toBe(featureRef("F-B"));
      expect(revParse(first.repo, INTEGRATION_REF)).toBe(first.base);
      expect(revParse(second.repo, INTEGRATION_REF)).toBe(second.base);
      expect(first.lifecycle.read("F-A").state).toBe("QUEUED_FOR_MERGE");
      expect(second.lifecycle.read("F-B").state).toBe("QUEUED_FOR_MERGE");
    } finally {
      removeRepo(first.repo);
      removeRepo(second.repo);
    }
  });

  it("re-runs merge-tree and re-verifies when integration moves before compare-and-swap", async () => {
    const prepared = prepare("F-Menu", shopLeaves());
    try {
      const real = createGitRefCas();
      let integrationAttempts = 0;
      let drifted = "";
      const result = await new FeatureIntegratorEngine().integrate(
        request(prepared, "F-Menu", {
          cas: {
            advance(input) {
              if (input.ref === INTEGRATION_REF) {
                integrationAttempts += 1;
                if (integrationAttempts === 1) {
                  drifted = commitAll(prepared.repo, "drift", { "docs/note.md": "upstream\n" }, "upstream", prepared.base);
                  pointRef(prepared.repo, INTEGRATION_REF, drifted);
                  return { ok: false, reason: "cas_mismatch", actualSha: drifted };
                }
              }
              return real.advance(input);
            },
          },
        }),
      );
      expect(integrationAttempts).toBe(2);
      expect(result.status).toBe("done");
      expect(commitParents(prepared.repo, result.integrationSha ?? "")[0]).toBe(drifted);
    } finally {
      removeRepo(prepared.repo);
    }
  });

  it("repairs a menu versus menu-items seam and blocks a vacuous sealed check", async () => {
    const prepared = prepare("F-Menu", [
      {
        taskId: "T-Menu",
        path: "src/features/menu/menu.ts",
        text: leafFile("menu"),
        scope: "src/features/menu/**",
        need: wiringNeed({ kind: "api", path: "/api/menu", taskId: "T-Menu", component: "MenuApi" }),
      },
    ]);
    try {
      const engine = new FeatureIntegratorEngine();
      const sealed: SealedCheck = {
        id: "sealed-items",
        run(snapshot) {
          const pass = (snapshot.files.get("src/routes.ts") ?? "").includes('"/api/menu-items"');
          return { pass, observed: pass ? "mounted" : "missing" };
        },
      };
      const result = await engine.integrate(
        request(prepared, "F-Menu", {
          sealedChecks: [sealed],
          viewportChecks: [],
          seamJourneys: [
            {
              id: "journey-items",
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
          requirements: [{ id: "R-T-Menu", checkStatus: "pass", waiverApproved: false }],
        }),
      );
      expect(result.status).toBe("done");
      expect(result.hints[0]?.detail).toBe("T-Order expects /api/menu-items while T-Menu mounted /api/menu");
      expect(result.redBeforeGreen[0]?.basePassed).toBe(false);
      expect(result.redBeforeGreen[0]?.featurePassed).toBe(true);
    } finally {
      removeRepo(prepared.repo);
    }

    const vacuousRepo = prepare("F-Menu", shopLeaves());
    try {
      await expect(
        new FeatureIntegratorEngine().integrate(
          request(vacuousRepo, "F-Menu", {
            sealedChecks: [{ id: "sealed-vacuous", run: () => ({ pass: true, observed: "always" }) }],
          }),
        ),
      ).rejects.toThrow(VacuousSealedCheckError);
      expect(vacuousRepo.lifecycle.read("F-Menu").state).toBe("LEAVES_MERGED");
      expect(revParse(vacuousRepo.repo, INTEGRATION_REF)).toBe(vacuousRepo.base);
    } finally {
      removeRepo(vacuousRepo.repo);
    }
  });

  it("refuses DONE when a contract change request is open and fences a stale epoch", async () => {
    const prepared = prepare("F-Menu", shopLeaves());
    try {
      await expect(
        new FeatureIntegratorEngine().integrate(
          request(prepared, "F-Menu", { openContractChangeRequestIds: ["CCR-9"] }),
        ),
      ).rejects.toThrow(FeatureDoneRefusedError);
      expect(prepared.lifecycle.read("F-Menu").state).toBe("MERGED");
    } finally {
      removeRepo(prepared.repo);
    }

    const stale = prepare("F-Menu", shopLeaves());
    try {
      await expect(
        new FeatureIntegratorEngine().integrate(request(stale, "F-Menu", { expectedEpoch: 1 })),
      ).rejects.toThrow(StaleEpochError);
      expect(revParse(stale.repo, INTEGRATION_REF)).toBe(stale.base);
    } finally {
      removeRepo(stale.repo);
    }

    const early = prepare("F-Menu", shopLeaves());
    try {
      early.lifecycle.init("F-Menu", 3, "IN_WAVE");
      await expect(new FeatureIntegratorEngine().integrate(request(early, "F-Menu"))).rejects.toThrow(
        FeatureNotReadyError,
      );
    } finally {
      removeRepo(early.repo);
    }
  });

  it("stops when feature-integrator@1 returns blocked", async () => {
    const prepared = prepare("F-Menu", shopLeaves());
    try {
      const result = await new FeatureIntegratorEngine().integrate(
        request(prepared, "F-Menu", {
          modelOutput: { blocked: true, reason: "Route contracts cannot both be kept" },
        }),
      );
      expect(result.status).toBe("blocked");
      expect(result.output).toMatchObject({ blocked: true });
      expect(prepared.lifecycle.read("F-Menu").state).toBe("LEAVES_MERGED");
    } finally {
      removeRepo(prepared.repo);
    }
  });
});
