import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MaintenanceWindowDrainer,
  RepoWideSweepConflictError,
  StaleSweepLeaseRecovery,
  SweepLeaseCoordinator,
  SweepOrchestrator,
  buildSweepPlanPreview,
  partitionTailShards,
  requiresApproval,
  type DrainProgress,
  type SweepPlannerPlan,
} from "../../src/sweeps/index.js";
import {
  InMemorySweepLeasePort,
  InMemoryTaskRuntimePort,
  RecordingWorktreePort,
  createOrchestratorPorts,
  overlaps,
} from "./harness.js";
import { createTsMorphCodemodBackend } from "./ts-morph-backend.js";

describe("SweepLeaseCoordinator", () => {
  it("blocks overlapping new claims at intent while allowing disjoint claims", () => {
    const leases = new InMemorySweepLeasePort();
    const coordinator = new SweepLeaseCoordinator({ leases });
    coordinator.acquireIntent({
      leaseId: "L-app",
      sweepTask: "S-app",
      scope: { kind: "globs", globs: ["src/app/**"] },
      now: 1,
    });
    const blocked = coordinator.overlappingIntentBlocksClaim(["src/app/kitchen/"], [
      { leaseId: "L-app", mode: "intent", prefixes: ["src/app/"] },
    ]);
    const allowed = coordinator.overlappingIntentBlocksClaim(["docs/"], [
      { leaseId: "L-app", mode: "intent", prefixes: ["src/app/"] },
    ]);
    expect(blocked).toBe(true);
    expect(allowed).toBe(false);
  });

  it("grants only after overlapping active tasks drain and releases on STOP", async () => {
    const tasks = new InMemoryTaskRuntimePort();
    tasks.setTask("T-kitchen", ["src/app/kitchen/"], "CODING");
    const leases = new InMemorySweepLeasePort(tasks);
    const coordinator = new SweepLeaseCoordinator({ leases });
    coordinator.acquireIntent({
      leaseId: "L-app",
      sweepTask: "S-app",
      scope: { kind: "globs", globs: ["src/app/**"] },
      now: 1,
    });
    expect(coordinator.tryGrant("L-app").granted).toBe(false);
    tasks.parkTask("T-kitchen");
    expect(coordinator.tryGrant("L-app").granted).toBe(true);
    expect(coordinator.release("L-app").released).toBe(true);
    expect(leases.snapshot().size).toBe(0);
  });

  it("serializes overlapping sweeps by lease id and keeps disjoint sweeps parallel", () => {
    const leases = new InMemorySweepLeasePort();
    const coordinator = new SweepLeaseCoordinator({ leases });
    coordinator.acquireIntent({
      leaseId: "L-b",
      sweepTask: "S-b",
      scope: { kind: "globs", globs: ["src/app/**"] },
      now: 1,
    });
    coordinator.acquireIntent({
      leaseId: "L-a",
      sweepTask: "S-a",
      scope: { kind: "globs", globs: ["src/app/**"] },
      now: 1,
    });
    expect(coordinator.tryGrant("L-b").blockedBy).toBe("L-a");
    expect(coordinator.tryGrant("L-a").granted).toBe(true);
    coordinator.acquireIntent({
      leaseId: "L-ui",
      sweepTask: "S-ui",
      scope: { kind: "globs", globs: ["packages/ui/**"] },
      now: 2,
    });
    coordinator.acquireIntent({
      leaseId: "L-api",
      sweepTask: "S-api",
      scope: { kind: "globs", globs: ["packages/api/**"] },
      now: 2,
    });
    expect(coordinator.tryGrant("L-ui").granted).toBe(true);
    expect(coordinator.tryGrant("L-api").granted).toBe(true);
    expect(overlaps("packages/ui/", "packages/api/")).toBe(false);
  });

  it("rejects a second repo-wide sweep lease", () => {
    const leases = new InMemorySweepLeasePort();
    const coordinator = new SweepLeaseCoordinator({ leases });
    coordinator.acquireIntent({
      leaseId: "L-wide",
      sweepTask: "S-wide",
      scope: { kind: "repo_wide" },
      now: 1,
    });
    expect(() =>
      coordinator.acquireIntent({
        leaseId: "L-wide-2",
        sweepTask: "S-wide-2",
        scope: { kind: "repo_wide" },
        now: 2,
      }),
    ).toThrow(RepoWideSweepConflictError);
  });
});

describe("MaintenanceWindowDrainer", () => {
  it("publishes drain progress and grants after overlapping work parks", async () => {
    const tasks = new InMemoryTaskRuntimePort();
    tasks.setTask("T1", ["src/"], "CODING");
    tasks.setTask("T2", ["src/"], "LEASED");
    const leases = new InMemorySweepLeasePort(tasks);
    tasks.setTask("T-docs", ["docs/"], "CODING");
    const drainer = new MaintenanceWindowDrainer({ leases, tasks, pollIntervalMs: 5 });
    const lease = new SweepLeaseCoordinator({ leases }).acquireIntent({
      leaseId: "L-rename",
      sweepTask: "S-rename",
      scope: { kind: "globs", globs: ["src/**"] },
      now: 1,
    });
    const progress: DrainProgress[] = [];
    const result = await drainer.drainUntilGranted({
      leaseId: lease.leaseId,
      sweepTask: "S-rename",
      sweepLabel: "Rename User → Account",
      leasePrefixes: lease.prefixes,
      isCancelled: () => false,
      onProgress: (p) => progress.push(p),
    });
    expect(result.ok).toBe(true);
    expect(progress.some((p) => p.overlappingActive > 0)).toBe(true);
    expect(progress.some((p) => p.overlappingActive === 0)).toBe(true);
    expect(result.ok && result.granted.granted).toBe(true);
    expect(tasks.listActiveTasks().find((t) => t.taskId === "T-docs")?.state).toBe("CODING");
  });

  it("releases intent immediately on cancel", async () => {
    const leases = new InMemorySweepLeasePort();
    const tasks = new InMemoryTaskRuntimePort();
    tasks.setTask("T1", ["src/"], "CODING");
    const drainer = new MaintenanceWindowDrainer({ leases, tasks, pollIntervalMs: 5 });
    new SweepLeaseCoordinator({ leases }).acquireIntent({
      leaseId: "L-cancel",
      sweepTask: "S-cancel",
      scope: { kind: "globs", globs: ["src/**"] },
      now: 1,
    });
    const result = await drainer.drainUntilGranted({
      leaseId: "L-cancel",
      sweepTask: "S-cancel",
      sweepLabel: "Rename",
      leasePrefixes: ["src/"],
      isCancelled: () => true,
    });
    expect(result.ok).toBe(false);
    expect(leases.snapshot().size).toBe(0);
  });
});

describe("DeterministicCodemodRunner + ts-morph", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length > 0) dirs.pop();
  });

  function seedFiftyFileProject(oldName: string): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ef-sweep-tsmorph-"));
    dirs.push(dir);
    for (let i = 0; i < 50; i += 1) {
      const file = path.join(dir, `module-${String(i).padStart(2, "0")}.ts`);
      const comment = i === 7 ? `// keep comment mentioning ${oldName} verbatim` : "// generated";
      const decoy = i === 3 ? `const mock = { ${oldName}: true };` : "";
      writeFileSync(
        file,
        `${comment}\nexport function ${oldName}() { return ${i}; }\n${decoy}\n`,
        "utf8",
      );
    }
    return dir;
  }

  it(
    "renames across a 50-file fixture without touching decoy property names",
    async () => {
    const backend = createTsMorphCodemodBackend();
    if (!backend) {
      expect.fail("ts-morph must be available from the workspace root for Task 184");
    }
    const oldName = "getUser";
    const newName = "getAccount";
    const root = seedFiftyFileProject(oldName);
    const { DeterministicCodemodRunner } = await import("../../src/sweeps/deterministic-codemod-runner.js");
    const runner = new DeterministicCodemodRunner({
      sandbox: { run: async () => ({ exitCode: 0, stdout: "", stderr: "" }) },
      codemods: backend,
    });
    const result = await runner.runTsMorphRename({
      projectRoot: root,
      oldName,
      newName,
      fileGlobs: ["**/*.ts"],
      dryRun: false,
    });
    if (!result.ok) {
      expect.fail(`ts-morph failed: ${result.reason} ${result.detail}`);
    }
    expect(result.preview.filesChanged).toBeGreaterThanOrEqual(50);
    const decoy = readFileSync(path.join(root, "module-03.ts"), "utf8");
    expect(decoy).toContain("getUser:");
    const commentFile = readFileSync(path.join(root, "module-07.ts"), "utf8");
    expect(commentFile).toContain("getUser verbatim");
    expect(readFileSync(path.join(root, "module-00.ts"), "utf8")).toContain(`function ${newName}`);
    },
    30_000,
  );
});

describe("SweepOrchestrator", () => {
  it("partitions tail shards to <= 8 files and uses harness/s branch", async () => {
    const ports = createOrchestratorPorts();
    const orchestrator = new SweepOrchestrator({ ports });
    const tail = Array.from({ length: 17 }, (_, i) => `edge/file-${i}.ts`);
    const plan: SweepPlannerPlan = {
      mechanicalSteps: [
        {
          engine: "ts-morph",
          scopeGlobs: ["rename:getUser->getAccount", "src/**"],
          dryRun: false,
        },
      ],
      tailPaths: tail,
      behaviorPreserving: true,
      persistedNamesKept: ["order_items"],
    };
    const shards = partitionTailShards(plan.tailPaths);
    expect(shards.every((s) => s.paths.length <= 8)).toBe(true);
    expect(shards.length).toBe(3);
    const preview = buildSweepPlanPreview("Rename OrderItem → MealOrderItem", plan, {
      persistedTable: "order_items",
    });
    expect(requiresApproval(preview, true)).toBe(true);
    expect(preview.summaryLine).toContain("order_items");

    const result = await orchestrator.run({
      sweepId: "SW-1",
      slug: "rename-user-account",
      label: "Rename User → Account",
      scope: { kind: "globs", globs: ["src/**"] },
      plan,
      integrationHead: "abc123",
      now: 10,
      approved: true,
    });
    if (!result.ok) {
      expect.fail(`orchestrator failed: ${result.phase} ${result.detail}`);
    }
    if (result.ok) {
      expect(result.branch).toBe("harness/s/rename-user-account");
      expect(result.shards.length).toBe(3);
    }
    const wt = ports.worktrees as RecordingWorktreePort;
    expect(wt.branches).toContain("harness/s/rename-user-account");
  });

  it("aborts safely on STOP and releases leases", async () => {
    const leases = new InMemorySweepLeasePort();
    const ports = createOrchestratorPorts({ leases });
    const orchestrator = new SweepOrchestrator({ ports });
    orchestrator.stop();
    const result = await orchestrator.run({
      sweepId: "SW-stop",
      slug: "stop-sweep",
      label: "Stop me",
      scope: { kind: "globs", globs: ["src/**"] },
      plan: {
        mechanicalSteps: [],
        tailPaths: [],
        behaviorPreserving: true,
        persistedNamesKept: [],
      },
      integrationHead: "deadbeef",
      now: 1,
      approved: true,
      isCancelled: () => true,
    });
    expect(result.ok).toBe(false);
    expect(leases.snapshot().size).toBe(0);
  });
});

describe("StaleSweepLeaseRecovery", () => {
  it("detects orphaned leases for Welcome-Back resume/discard", async () => {
    const leases = new InMemorySweepLeasePort();
    leases.openSweepIntent({ leaseId: "L-crash", sweepTask: "S-crash", globs: ["src/**"], now: 1 });
    const recovery = new StaleSweepLeaseRecovery({
      reader: {
        listOrphanedSweepLeases: () => [
          { leaseId: "L-crash", sweepTask: "S-crash", mode: "granted", branch: "harness/s/crash" },
        ],
      },
      leases,
      discardBranch: async () => undefined,
    });
    const detected = recovery.detectOnColdOpen();
    expect(detected.prompt).toContain("Resume or Discard Sweep");
    expect(detected.leases).toHaveLength(1);
    await recovery.applyChoice("L-crash", "discard", "crash");
    expect(leases.snapshot().size).toBe(0);
  });
});