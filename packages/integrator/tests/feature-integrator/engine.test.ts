import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it as vitestIt } from "vitest";
import { bindKnowledgeGraph, openProjectStateDb } from "@ef-harness/db";
import { RefLeaseManager, bindRefLeaseStateDb, createDirectGitRunner } from "@ef-harness/git-engine";

const it = (name: string, fn: () => void | Promise<void>): void => {
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
  bindProjectLifecycle,
  bindRefLeaseManager,
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

async function prepare(
  featureId: string,
  files: { taskId: string; path: string; text: string; scope: string; need: LeafCommitInput["wiringNeeds"][number] }[],
) {
  const repo = await initRepo();
  const base = await commitAll(repo, "main", { "README.md": "base\n" }, "base");
  await pointRef(repo, INTEGRATION_REF, base);
  await pointRef(repo, featureRef(featureId), base);
  const leaves: LeafCommitInput[] = [];
  for (const file of files) {
    const sha = await commitAll(repo, file.taskId, { [file.path]: file.text }, file.taskId, base);
    leaves.push({
      taskId: file.taskId,
      sha,
      objective: `Deliver ${file.taskId}`,
      requirementIds: [`R-${file.taskId}`],
      checkIds: [`AC-${file.taskId}`],
      writeScope: [file.scope],
      wiringNeeds: [file.need],
    });
  }
  const lifecycle = new InMemoryFeatureLifecycle();
  lifecycle.init(featureId, 3);
  return { repo, base, leaves, lifecycle };
}

function request(
  prepared: Awaited<ReturnType<typeof prepare>>,
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
    const prepared = await prepare("F-Menu", shopLeaves());
    try {
      const result = await new FeatureIntegratorEngine().integrate(request(prepared, "F-Menu"));
      expect(result.status).toBe("done");
      expect(result.featureState).toBe("DONE");
      expect(result.phase).toBe("INTEGRATING");
      expect(result.wiringTaskId).toBe("wiring-F-Menu");
      expect((await prepared.lifecycle.read("F-Menu")).state).toBe("DONE");
      expect(result.commitSha).toBeTruthy();
      expect(await revParse(prepared.repo, INTEGRATION_REF)).toBe(result.integrationSha);
      const message = await commitMessage(prepared.repo, result.commitSha ?? "");
      const trailers = parseEfTrailers(message);
      expect(trailers).toEqual({
        feature: "F-Menu",
        tasks: ["T-Menu", "T-Order"],
        requirements: ["R-T-Menu", "R-T-Order"],
        checksPassed: result.trailers?.checksPassed,
        harnessVersion: "0.0.0",
      });
      expect(trailers?.checksPassed).toMatch(/^[0-9a-f]{64}$/);
      expect(await commitParents(prepared.repo, result.commitSha ?? "")).toEqual([prepared.base]);
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

  it("integrates against real ProjectStateDb LifecycleRepo and RefLeaseManager CAS", async () => {
    const prepared = await prepare("F-Db", shopLeaves());
    const dbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ef-fi-db-"));
    const stateDb = openProjectStateDb({ projectId: "proj-fi", rootDir: dbRoot });
    try {
      const kg = bindKnowledgeGraph(stateDb);
      kg.commitChangeSet({
        origin: "planner",
        author: "test",
        summary: "seed feature and tasks",
        nodes: [
          { op: "create", id: "F-Db", kind: "feature", title: "Feature DB", status: "active", fields: {} },
          {
            op: "create",
            id: "T-Menu",
            kind: "task",
            title: "Menu leaf",
            status: "active",
            fields: { write_scope: ["src/features/menu/**"] },
          },
          {
            op: "create",
            id: "T-Order",
            kind: "task",
            title: "Order leaf",
            status: "active",
            fields: { write_scope: ["src/features/order/**"] },
          },
          {
            op: "create",
            id: "wiring-F-Db",
            kind: "task",
            title: "Wiring task",
            status: "active",
            fields: { write_scope: ["src/routes.ts"] },
          },
          { op: "create", id: "R-T-Menu", kind: "spec_item", title: "Req menu", status: "active", fields: { feature: "F-Db" } },
          { op: "create", id: "R-T-Order", kind: "spec_item", title: "Req order", status: "active", fields: { feature: "F-Db" } },
          {
            op: "create",
            id: "check-journey-db",
            kind: "check",
            title: "Journey check",
            status: "active",
            fields: { feature: "F-Db", gate: "feature_journey" },
          },
          {
            op: "create",
            id: "check-req-db",
            kind: "check",
            title: "Requirement check",
            status: "active",
            fields: { feature: "F-Db", gate: "feature_journey" },
          },
        ],
        edges: [
          { op: "create", src: "T-Menu", dst: "R-T-Menu", type: "implements" },
          { op: "create", src: "T-Order", dst: "R-T-Order", type: "implements" },
          { op: "create", src: "check-req-db", dst: "R-T-Menu", type: "verifies" },
          { op: "create", src: "check-req-db", dst: "R-T-Order", type: "verifies" },
        ],
      });
      const rev = stateDb.writer.get("SELECT COALESCE(MAX(rev), 1) AS r FROM change_sets", []);
      const currentRev = Number(rev?.r ?? 1);
      stateDb.writer.run(
        "INSERT INTO feature_runtime(feature, state, epoch, integration_holder, branch, updated_rev) VALUES (?, 'LEAVES_MERGED', 3, 'feature-author', ?, ?)",
        ["F-Db", featureRef("F-Db"), currentRev],
      );
      for (const t of ["T-Menu", "T-Order", "wiring-F-Db"]) {
        stateDb.writer.run(
          "INSERT INTO task_runtime(task, feature, state, level, updated_rev) VALUES (?, 'F-Db', 'MERGED_TO_FEATURE', 'leaf', ?)",
          [t, currentRev],
        );
        stateDb.writer.run(
          "INSERT INTO attempts(id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at) VALUES (?, ?, 1, 0, 1, 'local', 'test', 'direct', ?, 'accepted', 1000)",
          [`att-${t}`, t, prepared.base],
        );
      }
      stateDb.writer.run(
        "INSERT INTO check_results(check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at) VALUES ('check-journey-db', 'att-T-Menu', 1, 'sha256:0000', 'pass', '{}', 1000), ('check-req-db', 'att-T-Menu', 1, 'sha256:0000', 'pass', '{}', 1000)",
        [],
      );

      const leaseDb = bindRefLeaseStateDb(stateDb);
      const refManager = new RefLeaseManager({
        database: leaseDb,
        git: createDirectGitRunner(),
        repoPath: prepared.repo,
      });
      const fLease = await refManager.acquireRefLease({
        ref: featureRef("F-Db"),
        holder: "feature-author",
        ttlMs: 60_000,
      });
      const iLease = await refManager.acquireRefLease({
        ref: INTEGRATION_REF,
        holder: "feature-author",
        ttlMs: 60_000,
      });
      stateDb.writer.run(
        "UPDATE ref_leases SET epoch = 3 WHERE ref IN (?, ?)",
        [featureRef("F-Db"), INTEGRATION_REF],
      );
      void fLease;
      void iLease;

      const dbLifecycle = bindProjectLifecycle(stateDb);
      const cas = bindRefLeaseManager(refManager);
      const result = await new FeatureIntegratorEngine().integrate(
        request(prepared, "F-Db", {
          lifecycle: dbLifecycle,
          cas,
        }),
      );
      expect(result.status).toBe("done");
      expect(result.featureState).toBe("DONE");
      expect((await dbLifecycle.read("F-Db")).state).toBe("DONE");
    } finally {
      stateDb.close();
      fs.rmSync(dbRoot, { recursive: true, force: true });
      removeRepo(prepared.repo);
    }
  });

  it("preserves logical history when configured and still stamps the tip commit", async () => {
    const prepared = await prepare("F-Menu", shopLeaves());
    try {
      const result = await new FeatureIntegratorEngine().integrate(
        request(prepared, "F-Menu", { history: "preserve" }),
      );
      expect(result.status).toBe("done");
      const count = (
        await gitOk({
          repo: prepared.repo,
          args: ["rev-list", "--count", `${prepared.base}..${featureRef("F-Menu")}`],
        })
      ).stdout.trim();
      expect(Number(count)).toBeGreaterThan(1);
      expect(parseEfTrailers(await commitMessage(prepared.repo, result.commitSha ?? ""))?.feature).toBe("F-Menu");
    } finally {
      removeRepo(prepared.repo);
    }
  });

  it("queues two features on isolated branches without moving harness/integration", async () => {
    const first = await prepare("F-A", shopLeaves());
    const second = await prepare("F-B", shopLeaves());
    try {
      const engine = new FeatureIntegratorEngine();
      const left = await engine.integrate(request(first, "F-A", { mode: "m3_queue" }));
      const right = await engine.integrate(request(second, "F-B", { mode: "m3_queue" }));
      expect(left.status).toBe("queued_for_merge");
      expect(right.status).toBe("queued_for_merge");
      expect(left.queueHandoff?.target).toBe("Task 111");
      expect(right.queueHandoff?.featureRef).toBe(featureRef("F-B"));
      expect(await revParse(first.repo, INTEGRATION_REF)).toBe(first.base);
      expect(await revParse(second.repo, INTEGRATION_REF)).toBe(second.base);
      expect((await first.lifecycle.read("F-A")).state).toBe("QUEUED_FOR_MERGE");
      expect((await second.lifecycle.read("F-B")).state).toBe("QUEUED_FOR_MERGE");
    } finally {
      removeRepo(first.repo);
      removeRepo(second.repo);
    }
  });

  it("re-runs merge-tree and re-verifies when integration moves before compare-and-swap", async () => {
    const prepared = await prepare("F-Menu", shopLeaves());
    try {
      const real = createGitRefCas();
      let integrationAttempts = 0;
      let drifted = "";
      const result = await new FeatureIntegratorEngine().integrate(
        request(prepared, "F-Menu", {
          cas: {
            async advance(input) {
              if (input.ref === INTEGRATION_REF) {
                integrationAttempts += 1;
                if (integrationAttempts === 1) {
                  drifted = await commitAll(prepared.repo, "drift", { "docs/note.md": "upstream\n" }, "upstream", prepared.base);
                  await pointRef(prepared.repo, INTEGRATION_REF, drifted);
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
      expect((await commitParents(prepared.repo, result.integrationSha ?? ""))[0]).toBe(drifted);
    } finally {
      removeRepo(prepared.repo);
    }
  });

  it("repairs a menu versus menu-items seam and blocks a vacuous sealed check", async () => {
    const prepared = await prepare("F-Menu", [
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

    const vacuousRepo = await prepare("F-Menu", shopLeaves());
    try {
      await expect(
        new FeatureIntegratorEngine().integrate(
          request(vacuousRepo, "F-Menu", {
            sealedChecks: [{ id: "sealed-vacuous", run: () => ({ pass: true, observed: "always" }) }],
          }),
        ),
      ).rejects.toThrow(VacuousSealedCheckError);
      expect((await vacuousRepo.lifecycle.read("F-Menu")).state).toBe("LEAVES_MERGED");
      expect(await revParse(vacuousRepo.repo, INTEGRATION_REF)).toBe(vacuousRepo.base);
    } finally {
      removeRepo(vacuousRepo.repo);
    }
  });

  it("refuses DONE when a contract change request is open and fences a stale epoch", async () => {
    const prepared = await prepare("F-Menu", shopLeaves());
    try {
      await expect(
        new FeatureIntegratorEngine().integrate(
          request(prepared, "F-Menu", { openContractChangeRequestIds: ["CCR-9"] }),
        ),
      ).rejects.toThrow(FeatureDoneRefusedError);
      expect((await prepared.lifecycle.read("F-Menu")).state).toBe("MERGED");
    } finally {
      removeRepo(prepared.repo);
    }

    const stale = await prepare("F-Menu", shopLeaves());
    try {
      await expect(
        new FeatureIntegratorEngine().integrate(request(stale, "F-Menu", { expectedEpoch: 1 })),
      ).rejects.toThrow(StaleEpochError);
      expect(await revParse(stale.repo, INTEGRATION_REF)).toBe(stale.base);
    } finally {
      removeRepo(stale.repo);
    }

    const early = await prepare("F-Menu", shopLeaves());
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
    const prepared = await prepare("F-Menu", shopLeaves());
    try {
      const result = await new FeatureIntegratorEngine().integrate(
        request(prepared, "F-Menu", {
          modelOutput: { blocked: true, reason: "Route contracts cannot both be kept" },
        }),
      );
      expect(result.status).toBe("blocked");
      expect(result.output).toMatchObject({ blocked: true });
      expect((await prepared.lifecycle.read("F-Menu")).state).toBe("LEAVES_MERGED");
    } finally {
      removeRepo(prepared.repo);
    }
  });
});
