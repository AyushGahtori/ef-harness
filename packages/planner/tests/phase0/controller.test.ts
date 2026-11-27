import fs from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalPhase0RecipeGenerator } from "../../src/phase0/catalog.js";
import { canonicalLockfile, lockfileHash } from "../../src/phase0/lockfile.js";
import { Phase0Error } from "../../src/phase0/errors.js";
import { runGit, writeTree } from "../../src/phase0/git-repo.js";
import { Gate0ReceiptSchema } from "../../src/phase0/schema.js";
import { createPhase0Stack } from "../../src/phase0/runtime.js";
import type { Phase0Plan, Phase0Recipe, Phase0RunRequest } from "../../src/phase0/types.js";
import { countingWorker, openStack, subset, type OpenedStack } from "./support.js";

const opened: OpenedStack[] = [];

afterEach(async () => {
  for (const stack of opened.splice(0)) await stack.cleanup();
});

const generator = new LocalPhase0RecipeGenerator();

describe("Phase0ExecutionController", () => {
  it("runs P0.1 before parallel P0.2-P0.8 and unlocks Wave 1 on Gate 0 PASS", async () => {
    const counted = countingWorker();
    const openedStack = await use("web", { worker: counted.worker });
    const request: Phase0RunRequest = { projectId: "web", projectKind: "web_saas" };
    const result = await openedStack.stack.controller.run(request);
    expect(result.status).toBe("gate0_pass");
    expect(result.wave1Unlocked).toBe(true);
    expect(result.completedTaskIds).toEqual(["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"]);
    expect(result.maxConcurrency.stage0A).toBe(1);
    expect(result.maxConcurrency.stage0B).toBeGreaterThanOrEqual(2);
    expect(result.merges.some((merge) => merge.method === "fast-forward")).toBe(true);
    expect(result.merges.some((merge) => merge.method === "merge")).toBe(true);
    const mergedAt = result.schedule.findIndex((event) => event.taskId === "P0.1" && event.kind === "merged");
    const stageB = result.schedule.findIndex((event) => event.stage === "0B" && event.kind === "start");
    expect(stageB).toBeGreaterThan(mergedAt);
    expect(await openedStack.stack.repo.branch()).toBe("harness/integration");
    expect((await openedStack.stack.repo.porcelain()).trim()).toBe("");
    for (const merge of result.merges) {
      expect(await openedStack.stack.repo.isAncestor(merge.sha, "HEAD")).toBe(true);
    }
    const receipt = result.receipt;
    expect(receipt?.status).toBe("PASS");
    expect(Gate0ReceiptSchema.parse(JSON.parse(JSON.stringify(receipt))).schema).toBe("gate0_receipt@1");
    expect(receipt?.commands.find((command) => command.id === "unit_smoke")?.exitCode).toBe(0);
    expect(receipt?.styleguideThumbnail?.route).toBe("/__styleguide");
    const preview = openedStack.stack.cas.get(receipt?.styleguideThumbnail?.casId ?? "");
    expect(preview?.[0]).toBe(137);
    expect(preview?.[1]).toBe(80);
    expect(receipt?.styleguideThumbnail?.viewport).toBe("1440");
    expect(openedStack.stack.harnessRuns.length).toBeGreaterThan(0);
    expect(result.manifest?.gate0CommitSha).toBe(result.integrationSha);
    const installed = openedStack.stack.installer.calls[0];
    expect(installed?.frozenLockfile).toBe(true);
    expect(result.manifest?.installedDependenciesHash).toBe(lockfileHash(canonicalLockfile(installed?.dependencies ?? [])));
    expect(result.manifest?.styleguideScreenshotCasIds).toHaveLength(2);
    expect(result.manifest?.templateDbHash).not.toBe("none");
    expect(await openedStack.stack.controller.isWave1Unlocked("web")).toBe(true);

    const again = await openedStack.stack.controller.run(request);
    expect(again.schedule.every((event) => event.kind === "skipped")).toBe(true);
    expect(counted.calls).toHaveLength(8);

    await writeTree(openedStack.root, { "AFTER.txt": "moved\n" });
    await openedStack.stack.repo.commitAll(openedStack.root, "phase0: move head");
    expect(await openedStack.stack.controller.isWave1Unlocked("web")).toBe(false);
    expect(openedStack.stack.store.latestReceipt("web", result.integrationSha)?.status).toBe("PASS");
  }, 120_000);

  it("keeps Stage 0B queued when the kernel installer rejects a dependency or the registry is offline", async () => {
    const unapproved = countingWorker({
      async execute(context) {
        const base = await countingWorker().worker.execute(context);
        if (context.task.id !== "P0.1") return base;
        return { ...base, dependencyIntents: [{ name: "left-pad", version: "1.0.0", approved: false }] };
      },
    });
    const blocked = await use("unapproved", { worker: unapproved.worker });
    const result = await blocked.stack.controller.run({ projectId: "unapproved", projectKind: "web_saas" });
    expect(result.status).toBe("blocked_install");
    expect(result.wave1Unlocked).toBe(false);
    expect(result.queuedTaskIds).toEqual(["P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"]);
    expect(unapproved.calls.map((call) => call.taskId)).toEqual(["P0.1"]);
    expect(result.schedule.some((event) => event.stage === "0B")).toBe(false);
    expect(result.actionCards[0]?.message).toBe("unapproved dependency: left-pad@1.0.0");
    expect(result.actionCards[0]?.blocksStage0B).toBe(true);

    const offline = await use("offline");
    const offlineResult = await offline.stack.controller.run({ projectId: "offline", projectKind: "api", registryOffline: true });
    expect(offlineResult.status).toBe("blocked_install");
    expect(offlineResult.actionCards[0]?.message).toContain("offline registry");
    expect(offlineResult.schedule.some((event) => event.stage === "0B")).toBe(false);
  }, 120_000);

  it("stops after two Gate 0 repairs and escalates a missing Playwright browser without another coding worker", async () => {
    const typecheck = countingWorker();
    const plan = subset(generator.generate({ projectKind: "api" }), ["P0.1", "P0.5"]);
    const failed = await use("typecheck", { worker: typecheck.worker, commandExits: new Map([["typecheck", 1]]) });
    const result = await failed.stack.controller.run({ projectId: "typecheck", projectKind: "api", plan });
    expect(result.status).toBe("gate0_fail");
    expect(result.repairAttempts).toBe(2);
    expect(result.wave1Unlocked).toBe(false);
    expect(result.receipt?.failingTaskId).toBe("P0.1");
    expect(result.receipt?.failureKind).toBe("typecheck_failed");
    expect(typecheck.calls.filter((call) => call.mode === "repair")).toHaveLength(2);

    const browser = countingWorker();
    const ui = subset(generator.generate({ projectKind: "web_saas" }), ["P0.1", "P0.4", "P0.6"]);
    const escalated = await use("browser", { worker: browser.worker });
    const escalation = await escalated.stack.controller.run({
      projectId: "browser",
      projectKind: "web_saas",
      plan: ui,
      playwrightBrowserAvailable: false,
    });
    expect(escalation.status).toBe("escalated");
    expect(escalation.wave1Unlocked).toBe(false);
    expect(escalation.receipt?.escalated).toBe(true);
    expect(escalation.escalations.map((item) => item.kind)).toEqual(["component_downloader", "human_step_probe", "component_downloader"]);
    expect(browser.calls.every((call) => call.mode === "initial")).toBe(true);
  }, 120_000);

  it("fails Gate 0 while a test-env child is still alive", async () => {
    const plan = subset(generator.generate({ projectKind: "api" }), ["P0.1", "P0.6"]);
    const openedStack = await use("leak", { leakTeardowns: 5 });
    const result = await openedStack.stack.controller.run({ projectId: "leak", projectKind: "api", plan });
    expect(result.status).toBe("gate0_fail");
    expect(result.receipt?.failureKind).toBe("leaked_process");
    expect(result.receipt?.failingTaskId).toBe("P0.6");
    expect(result.repairAttempts).toBe(2);
    expect(result.wave1Unlocked).toBe(false);
  }, 120_000);

  it("routes hoisted package.json edits through the serial kernel installer", async () => {
    const plan = withIntents(subset(generator.generate({ projectKind: "web_saas" }), ["P0.1", "P0.2", "P0.4"]));
    const openedStack = await use("hoist");
    const result = await openedStack.stack.controller.run({ projectId: "hoist", projectKind: "web_saas", plan });
    expect(result.status).toBe("gate0_pass");
    expect(openedStack.stack.installer.calls[0]?.taskId).toBe("P0.1");
    expect(openedStack.stack.installer.calls[0]?.dependencies.some((intent) => intent.name === "left-pad" && intent.approved)).toBe(true);
    expect(openedStack.stack.installer.calls[0]?.frozenLockfile).toBe(true);
    const log = await runGit(openedStack.root, ["log", "--pretty=%s", "--", "package.json"]);
    expect(log.stdout).toContain("P0.1");
    expect(log.stdout).not.toContain("P0.2");
    expect(log.stdout).not.toContain("P0.4");
  }, 120_000);

  it("does not merge a task that tries to run npm install", async () => {
    const counted = countingWorker({
      async execute(context) {
        const base = await countingWorker().worker.execute(context);
        if (context.task.id !== "P0.5") return base;
        return { ...base, attemptedCommands: ["npm install left-pad"] };
      },
    });
    const plan = subset(generator.generate({ projectKind: "api" }), ["P0.1", "P0.5"]);
    const openedStack = await use("npm", { worker: counted.worker });
    const result = await openedStack.stack.controller.run({ projectId: "npm", projectKind: "api", plan });
    expect(result.status).toBe("incomplete");
    expect(result.wave1Unlocked).toBe(false);
    expect(result.failedTaskIds).toContain("P0.5");
    expect(result.completedTaskIds).toContain("P0.1");
    expect(result.completedTaskIds).not.toContain("P0.5");
  }, 120_000);

  it("resumes after P0.3 and does not redo merged tasks", async () => {
    const counted = countingWorker();
    const first = await use("resume", { worker: counted.worker });
    const request: Phase0RunRequest = {
      projectId: "resume",
      projectKind: "web_saas",
      onTaskMerged: (event) => {
        if (event.taskId === "P0.3") throw new Phase0Error("crashed", "simulated crash after P0.3");
      },
    };
    await expect(first.stack.controller.run(request)).rejects.toMatchObject({ code: "crashed" });
    const trace = first.stack.controller.inspection();
    expect(trace.schedule.filter((event) => event.kind === "merged").map((event) => event.taskId)).toEqual(["P0.1", "P0.2", "P0.3"]);
    const unmerged = first.stack.store.getTask("resume", "P0.4")?.unmergedSha;
    expect(unmerged).toBeTruthy();
    const paths = { root: first.root, statePath: path.join(first.metaRoot, "state.db"), slotsRoot: `${first.root}-slots` };
    await first.stack.dispose();
    const index = opened.indexOf(first);
    if (index >= 0) opened.splice(index, 1);
    const second = await createPhase0Stack({ ...paths, initRepo: false, worker: counted.worker });
    opened.push({
      root: first.root,
      metaRoot: first.metaRoot,
      stack: second,
      cleanup: async () => {
        await second.dispose();
        await fs.rm(first.root, { recursive: true, force: true });
        await fs.rm(first.metaRoot, { recursive: true, force: true });
      },
    });
    const result = await second.controller.resume("resume");
    expect(result.status).toBe("gate0_pass");
    expect(result.wave1Unlocked).toBe(true);
    expect(result.schedule.some((event) => event.taskId === "P0.4" && event.kind === "reset")).toBe(true);
    expect(counted.calls.filter((call) => call.taskId === "P0.1")).toHaveLength(1);
    expect(counted.calls.filter((call) => call.taskId === "P0.2")).toHaveLength(1);
    expect(counted.calls.filter((call) => call.taskId === "P0.3")).toHaveLength(1);
    expect(counted.calls.filter((call) => call.taskId === "P0.4").length).toBeGreaterThanOrEqual(2);
    expect(await second.repo.isAncestor(unmerged ?? "", "HEAD")).toBe(false);
    expect((await second.repo.porcelain()).trim()).toBe("");
  }, 180_000);

  it("skips P0.1 for brownfield repos and keeps pre-existing passing code green", async () => {
    const counted = countingWorker();
    const openedStack = await use("brown", { worker: counted.worker, knownBaselineFailures: ["known-fail-1", "known-fail-2", "known-fail-3", "known-fail-4"] });
    const legacy = "export const legacy = 1;\nprocess.stdout.write('legacy_ok\\n');\n";
    await writeTree(openedStack.root, {
      "src/legacy.mjs": legacy,
      "scripts/phase0/lint.mjs": "process.stdout.write('lint ok\\n');\n",
      "scripts/phase0/build.mjs": "process.stdout.write('build ok\\n');\n",
    });
    await openedStack.stack.repo.commitAll(openedStack.root, "phase0: existing repo");
    const result = await openedStack.stack.controller.run({ projectId: "brown", projectKind: "brownfield" });
    expect(result.status).toBe("gate0_pass");
    expect(result.completedTaskIds).toEqual(["P0.B1", "P0.B2"]);
    expect(counted.calls.map((call) => call.taskId).sort()).toEqual(["P0.B1", "P0.B2"]);
    expect(result.maxConcurrency.stage0A).toBe(0);
    expect(result.maxConcurrency.stage0B).toBeGreaterThanOrEqual(2);
    expect(openedStack.stack.store.quarantine("brown")).toEqual(["known-fail-1", "known-fail-2", "known-fail-3", "known-fail-4"]);
    expect(await fs.readFile(path.join(openedStack.root, "src", "legacy.mjs"), "utf8")).toBe(legacy);
    await expect(fs.access(path.join(openedStack.root, "package.json"))).rejects.toThrow();
  }, 120_000);

  it("skips UI steps for cli_tool and backend_api and runs web_fullstack inside the harness", async () => {
    const cli = generator.generate({ projectKind: "cli_tool" });
    expect(cli.projectKind).toBe("headless_cli");
    expect(cli.recipes.map((recipe) => recipe.id)).toEqual(["P0.1", "P0.2", "P0.5", "P0.6", "P0.7"]);
    expect(cli.omitted.map((item) => item.id)).toEqual(expect.arrayContaining(["P0.3", "P0.4", "P0.8"]));
    const api = generator.generate({ projectKind: "backend_api" });
    expect(api.recipes.map((recipe) => recipe.id)).not.toContain("P0.4");
    expect(api.recipes.map((recipe) => recipe.id)).not.toContain("P0.8");
    expect(api.recipes.map((recipe) => recipe.id)).toContain("P0.3");
    const web = generator.generate({ projectKind: "web_fullstack" });
    expect(web.projectKind).toBe("web_saas");
    expect(web.recipes[0]?.id).toBe("P0.1");
    expect(web.recipes.map((recipe) => recipe.id)).toEqual(["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"]);
    const openedStack = await use("fullstack");
    const plan = subset(web, ["P0.1", "P0.5"]);
    const result = await openedStack.stack.controller.run({ projectId: "fullstack", projectKind: "web_fullstack", plan });
    expect(result.status).toBe("gate0_pass");
    const mergedAt = result.schedule.findIndex((event) => event.taskId === "P0.1" && event.kind === "merged");
    const later = result.schedule.findIndex((event) => event.taskId === "P0.5" && event.kind === "start");
    expect(later).toBeGreaterThan(mergedAt);
    expect(openedStack.stack.harnessRuns.length).toBeGreaterThan(0);
  }, 60_000);

  it("refuses to run Phase 0 on main", async () => {
    const openedStack = await use("main");
    await runGit(openedStack.root, ["checkout", "-b", "main"]);
    await expect(openedStack.stack.controller.run({ projectId: "main", projectKind: "api" })).rejects.toMatchObject({ code: "protected_branch" });
  });
});

async function use(name: string, options: Parameters<typeof openStack>[1] = {}): Promise<OpenedStack> {
  const stack = await openStack(name, options);
  opened.push(stack);
  return stack;
}

function withIntents(plan: Phase0Plan): Phase0Plan {
  const recipes = plan.recipes.map((recipe: Phase0Recipe) =>
    recipe.id === "P0.2" || recipe.id === "P0.4"
      ? { ...recipe, writeScope: [...recipe.writeScope, "package.json"], dependencyIntents: [{ name: "left-pad", version: "1.0.0", approved: true as const }] }
      : recipe,
  );
  return { ...plan, recipes };
}
