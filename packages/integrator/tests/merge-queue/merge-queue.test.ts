import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { INTEGRATION_REF } from "../../src/merge-queue/constants.js";
import { SimulatedCrash } from "../../src/merge-queue/errors.js";
import { commitMessage, commitParents, gitOk, revParse, runGit } from "../../src/merge-queue/git.js";
import { ProjectMergeQueue, type MergeQueueHooks } from "../../src/merge-queue/queue.js";
import { parseEfTrailers } from "../../src/merge-queue/trailers.js";
import type { DoneSnapshot, MergeFeatureRequest, ProjectIntegratorModel } from "../../src/merge-queue/types.js";

const roots: string[] = [];
const repoRef: { repo: string } = { repo: "" };

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (!root) continue;
    rmSync(root, { recursive: true, force: true });
  }
});

function write(root: string, relative: string, text: string): void {
  const full = path.join(root, ...relative.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text, "utf8");
}

function initRepo(repo: string): void {
  gitOk(repo, ["init", "--initial-branch=harness/integration"]);
  write(repo, "build.mjs", "console.log('build ok');\n");
  write(repo, "notes/sentinel.txt", "SENTINEL_NOT_FOR_MODEL\n");
  gitOk(repo, ["add", "-A"]);
  gitOk(repo, ["commit", "-m", "base"]);
  gitOk(repo, ["checkout", "--detach"]);
}

function addFeature(repo: string, id: string, files: Record<string, string>): void {
  const branch = `harness/f/${id}`;
  gitOk(repo, ["branch", branch, "harness/integration"]);
  const slot = mkdtempSync(path.join(tmpdir(), "ef-feature-"));
  try {
    gitOk(repo, ["worktree", "add", slot, branch]);
    for (const [relative, text] of Object.entries(files)) write(slot, relative, text);
    gitOk(slot, ["add", "-A"]);
    gitOk(slot, ["commit", "-m", `feature ${id}`]);
  } finally {
    runGit(repo, ["worktree", "remove", "--force", slot]);
    rmSync(slot, { recursive: true, force: true });
  }
}

function featureTree(
  id: string,
  options: {
    readonly routes?: readonly string[];
    readonly shortcuts?: readonly string[];
    readonly journey?: string;
    readonly extra?: Record<string, string>;
  } = {},
): Record<string, string> {
  const manifest = {
    id,
    routes: options.routes ?? [`/${id}`],
    shortcuts: options.shortcuts ?? [],
    middleware: [],
    checks: [`features/${id}/journey.test.mjs`],
    sealed: [{ id: `${id}-3b`, step: "3b", script: `features/${id}/sealed/step-3b.test.mjs` }],
  };
  return {
    [`features/${id}/manifest.json`]: `${JSON.stringify(manifest, null, 2)}\n`,
    [`features/${id}/journey.test.mjs`]: options.journey ?? `console.log(${JSON.stringify(id)});\n`,
    [`features/${id}/sealed/step-3b.test.mjs`]: "console.log('sealed');\n",
    ...(options.extra ?? {}),
  };
}

function passingSnapshot(id: string, earlier: readonly string[] = []): DoneSnapshot {
  return {
    tasks: [
      {
        id: `T-${id}`,
        state: "MERGED_TO_FEATURE",
        briefVersion: 1,
        acceptedBriefVersion: 1,
        contracts: [{ id: `C-${id}`, pin: 1, currentVersion: 1 }],
      },
    ],
    requirements: [{ id: `R-${id}`, kind: "spec_item", status: "passing" }],
    scopes: [`features/${id}/`],
    checks: [
      { id: `S-${id}`, gate: "static_audit", version: 1, status: "pass" },
      { id: `J-${id}`, gate: "feature_journey", version: 1, status: "pass" },
      { id: `B-${id}`, gate: "sealed_step_3b", version: 1, status: "pass" },
    ],
    screenBearing: false,
    openCcrIds: [],
    earlierDoneFeatureIds: [...earlier],
  };
}

function request(id: string, snapshot: DoneSnapshot = passingSnapshot(id)): MergeFeatureRequest {
  return {
    featureId: id,
    featureRef: `refs/heads/harness/f/${id}`,
    spec: { id, title: `${id} title`, text: `${id} canonical spec`, contracts: [{ id: `contract-${id}`, text: `${id} contract` }] },
    snapshot,
    taskIds: [`T-${id}`],
    requirementIds: [`R-${id}`],
    checkIds: [`S-${id}`, `J-${id}`, `B-${id}`],
    journeyEntryPoint: `/${id}`,
    staticAuditPaths: [`features/${id}/`],
  };
}

interface Session {
  readonly root: string;
  readonly repo: string;
  readonly queue: ProjectMergeQueue;
}

async function withQueue(
  hooks: MergeQueueHooks | undefined,
  model: ProjectIntegratorModel | undefined,
  run: (session: Session) => Promise<void>,
  integrationWorktree = false,
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), "ef-mq-test-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  mkdirSync(repo);
  initRepo(repo);
  let preview: string | undefined;
  if (integrationWorktree) {
    preview = path.join(root, "preview");
    gitOk(repo, ["worktree", "add", "--detach", preview, "harness/integration"]);
  }
  const queue = new ProjectMergeQueue({
    repo,
    stateFile: path.join(root, "state.db"),
    ...(hooks ? { hooks } : {}),
    ...(model ? { model } : {}),
    ...(preview ? { integrationWorktree: preview } : {}),
  });
  try {
    await run({ root, repo, queue });
  } finally {
    queue.close();
    if (preview) runGit(repo, ["worktree", "remove", "--force", preview]);
  }
}

function show(repo: string, spec: string): string {
  return gitOk(repo, ["show", spec]).stdout;
}

function merges(repo: string): { sha: string; feature: string; parents: string[] }[] {
  const raw = gitOk(repo, ["log", "--merges", "--reverse", "--format=%H", "harness/integration"]).stdout;
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((sha) => ({
      sha,
      feature: parseEfTrailers(commitMessage(repo, sha))?.feature ?? "",
      parents: commitParents(repo, sha),
    }));
}

function ancestor(repo: string, older: string, newer: string): boolean {
  return runGit(repo, ["merge-base", "--is-ancestor", older, newer]).status === 0;
}

describe("project merge queue", () => {
  it(
    "drains in priority order with no-ff trailers, a 7-condition DONE commit, and a preview reload",
    async () => {
      await withQueue(
        undefined,
        undefined,
        async ({ root, repo, queue }) => {
          const before = queue.integrationSha();
          addFeature(repo, "F-Low", featureTree("F-Low"));
          addFeature(repo, "F-High", featureTree("F-High"));
          queue.enqueue({ ...request("F-Low"), priority: 1 });
          queue.enqueue({ ...request("F-High", passingSnapshot("F-High")), priority: 9 });
          const report = await queue.drain();
          expect(report.blocked).toBeNull();
          expect(report.evicted).toEqual([]);
          expect(report.landed.map((item) => item.featureId)).toEqual(["F-High", "F-Low"]);
          for (const landed of report.landed) {
            expect(landed.done).toBe(true);
            expect(landed.failedConditions).toEqual([]);
            expect(landed.parents).toHaveLength(2);
            expect(landed.trailers.feature).toBe(landed.featureId);
            expect(landed.trailers.tasks).toEqual([`T-${landed.featureId}`]);
            expect(landed.trailers.checksPassed).toMatch(/^[a-f0-9]{64}$/);
          }
          const history = merges(repo);
          expect(history.map((item) => item.feature)).toEqual(["F-High", "F-Low"]);
          expect(history.every((item) => item.parents.length === 2)).toBe(true);
          expect(ancestor(repo, before, queue.integrationSha())).toBe(true);
          expect(ancestor(repo, revParse(repo, "refs/heads/harness/f/F-High"), queue.integrationSha())).toBe(true);
          expect(queue.runtimeState("F-High")).toBe("DONE");
          expect(queue.runtimeState("F-Low")).toBe("DONE");
          const preview = queue.events().filter((event) => event.kind === "preview-reload");
          expect(preview.length).toBeGreaterThan(0);
          expect(preview.at(-1)?.payload).toContain("\"restartPreview\":true");
          expect(queue.events().some((event) => event.kind === "FeatureCompleted")).toBe(true);
          const fastForwardable = runGit(repo, [
            "merge-base",
            "--is-ancestor",
            before,
            "refs/heads/harness/f/F-High",
          ]);
          expect(fastForwardable.status).toBe(0);
          expect(revParse(path.join(root, "preview"), "HEAD")).toBe(queue.integrationSha());
        },
        true,
      );
    },
    120_000,
  );

  it(
    "refuses DONE when a condition fails and leaves harness/integration on the green head",
    async () => {
      await withQueue(undefined, undefined, async ({ repo, queue }) => {
        const before = queue.integrationSha();
        addFeature(repo, "F-Open", featureTree("F-Open"));
        queue.enqueue(request("F-Open", { ...passingSnapshot("F-Open"), openCcrIds: ["CCR-9"] }));
        const report = await queue.drain();
        expect(report.landed).toEqual([]);
        expect(report.evicted.map((item) => item.kind)).toEqual(["done_refused"]);
        expect(report.evicted[0]?.trace).toContain("7");
        expect(queue.integrationSha()).toBe(before);
        expect(queue.runtimeState("F-Open")).toBe("INTEGRATING");
        expect(queue.events().some((event) => event.kind === "preview-reload")).toBe(false);
      });
    },
    120_000,
  );

  it(
    "bisects [F-Menu, F-Orders, F-Email], lands the clean features, and evicts only F-Orders",
    async () => {
      await withQueue(undefined, undefined, async ({ root, repo, queue }) => {
        const proof = path.join(root, "parallel.log");
        const wait = (id: string): string =>
          [
            "import { appendFileSync } from 'node:fs';",
            `const file = ${JSON.stringify(proof)};`,
            `appendFileSync(file, '${id} start ' + Date.now() + '\\n');`,
            "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);",
            `appendFileSync(file, '${id} end ' + Date.now() + '\\n');`,
            `console.log(${JSON.stringify(id)});`,
            "",
          ].join("\n");
        addFeature(repo, "F-Menu", featureTree("F-Menu", { journey: wait("F-Menu") }));
        addFeature(
          repo,
          "F-Orders",
          featureTree("F-Orders", {
            journey: "console.error('F-Orders clashes with F-Menu');\nprocess.exit(1);\n",
          }),
        );
        addFeature(repo, "F-Email", featureTree("F-Email", { journey: wait("F-Email") }));
        queue.enqueue(request("F-Menu"));
        queue.enqueue(request("F-Orders"));
        queue.enqueue(request("F-Email"));
        const before = queue.integrationSha();
        const report = await queue.drain();
        expect(report.landed.map((item) => item.featureId)).toEqual(["F-Menu", "F-Email"]);
        expect(report.evicted.map((item) => item.featureId)).toEqual(["F-Orders"]);
        expect(report.evicted[0]?.phase).toBe("INTEGRATING");
        expect(report.evicted[0]?.trace).toContain("F-Orders clashes with F-Menu");
        expect(queue.runtimeState("F-Orders")).toBe("INTEGRATING");
        expect(queue.runtimeState("F-Menu")).toBe("DONE");
        expect(queue.runtimeState("F-Email")).toBe("DONE");
        expect(ancestor(repo, revParse(repo, "refs/heads/harness/f/F-Orders"), queue.integrationSha())).toBe(false);
        expect(ancestor(repo, revParse(repo, "refs/heads/harness/f/F-Menu"), queue.integrationSha())).toBe(true);
        expect(ancestor(repo, revParse(repo, "refs/heads/harness/f/F-Email"), queue.integrationSha())).toBe(true);
        expect(queue.integrationSha()).not.toBe(before);
        const log = readFileSync(proof, "utf8");
        const menuStart = log.indexOf("F-Menu start");
        const emailStart = log.indexOf("F-Email start");
        const menuEnd = log.indexOf("F-Menu end");
        const emailEnd = log.indexOf("F-Email end");
        expect(menuStart).toBeGreaterThanOrEqual(0);
        expect(emailStart).toBeGreaterThanOrEqual(0);
        expect(Math.max(menuStart, emailStart)).toBeLessThan(Math.min(menuEnd, emailEnd));
      });
    },
    120_000,
  );

  it(
    "catches a duplicate /settings route before the ref moves and resolves it without weakening tests",
    async () => {
      await withQueue(undefined, undefined, async ({ repo, queue }) => {
        addFeature(repo, "F-Settings-A", featureTree("F-Settings-A", { routes: ["/settings"] }));
        addFeature(repo, "F-Settings-B", featureTree("F-Settings-B", { routes: ["/settings"] }));
        const before = queue.integrationSha();
        queue.enqueue(request("F-Settings-A"));
        queue.enqueue(request("F-Settings-B"));
        const report = await queue.drain();
        expect(report.evicted).toEqual([]);
        expect(report.escalations).toEqual([]);
        expect(report.landed.map((item) => item.featureId)).toEqual(["F-Settings-A", "F-Settings-B"]);
        const tip = queue.integrationSha();
        expect(tip).not.toBe(before);
        expect(show(repo, `${tip}:features/F-Settings-B/manifest.json`)).toContain('"/settings"');
        expect(show(repo, `${tip}:features/F-Settings-B/manifest.json`)).not.toContain("/settings--");
        expect(show(repo, `${tip}:features/F-Settings-A/manifest.json`)).toContain('"/settings"');
        expect(show(repo, `${tip}:features/F-Settings-A/journey.test.mjs`)).not.toContain(".skip");
        expect(queue.engine.prompts.join("\n")).not.toContain("SENTINEL_NOT_FOR_MODEL");
      });
    },
    120_000,
  );

  it(
    "rejects an integrator that silences a passing test and does not move harness/integration",
    async () => {
      const model: ProjectIntegratorModel = () => ({
        output: { migrations_order: [], ccr_decisions: [], rerun_suites: ["combined:duplicate-route:/settings"] },
        files: [
          {
            path: "features/F-Settings-A/journey.test.mjs",
            text: "describe.skip('silenced', () => { expect(true).toBe(true); });\n",
          },
        ],
      });
      await withQueue(undefined, model, async ({ repo, queue }) => {
        const clash = (self: string, other: string) =>
          `import { existsSync } from "node:fs";\nif (existsSync("features/${other}")) { console.error("${self} clashes with ${other}"); process.exit(1); }\nconsole.log(${JSON.stringify(self)});\n`;
        addFeature(repo, "F-Settings-A", featureTree("F-Settings-A", { routes: ["/settings"], journey: clash("F-Settings-A", "F-Settings-B") }));
        addFeature(repo, "F-Settings-B", featureTree("F-Settings-B", { routes: ["/settings"], journey: clash("F-Settings-B", "F-Settings-A") }));
        const before = queue.integrationSha();
        queue.enqueue(request("F-Settings-A"));
        queue.enqueue(request("F-Settings-B"));
        const report = await queue.drain();
        expect(report.landed).toEqual([]);
        expect(queue.integrationSha()).toBe(before);
        expect(report.escalations.map((item) => item.to)).toEqual(["developer"]);
        expect(report.escalations[0]?.attempts).toBe(2);
        expect(queue.engine.prompts.filter((item) => item.includes("clashes with"))).toHaveLength(2);
        expect(queue.itemStatus("F-Settings-A")).toBe("ESCALATED");
        expect(queue.itemStatus("F-Settings-B")).toBe("ESCALATED");
      });
    },
    120_000,
  );

  it(
    "fails the combined gate when a merged TypeScript file has a type error",
    async () => {
      await withQueue(undefined, undefined, async ({ repo, queue }) => {
        addFeature(
          repo,
          "F-Typed",
          featureTree("F-Typed", {
            extra: {
              "tsconfig.json": `${JSON.stringify({
                compilerOptions: {
                  strict: true,
                  noEmit: true,
                  target: "ES2022",
                  module: "NodeNext",
                  moduleResolution: "NodeNext",
                  skipLibCheck: true,
                },
                include: ["src/**/*.ts"],
              })}\n`,
              "src/bad.ts": "export const n: number = \"no\";\n",
            },
          }),
        );
        const before = queue.integrationSha();
        queue.enqueue(request("F-Typed"));
        const report = await queue.drain();
        expect(report.landed).toEqual([]);
        expect(report.evicted.map((item) => item.featureId)).toEqual(["F-Typed"]);
        expect(report.evicted[0]?.trace).toContain("not assignable to type 'number'");
        expect(queue.integrationSha()).toBe(before);
      });
    },
    120_000,
  );

  it(
    "keeps both sides of a nav conflict and orders colliding migrations",
    async () => {
      await withQueue(undefined, undefined, async ({ repo, queue }) => {
        const slot = mkdtempSync(path.join(tmpdir(), "ef-base-"));
        try {
          gitOk(repo, ["worktree", "add", slot, "harness/integration"]);
          write(slot, "shared/nav.txt", "home\n");
          gitOk(slot, ["add", "-A"]);
          gitOk(slot, ["commit", "-m", "nav"]);
        } finally {
          runGit(repo, ["worktree", "remove", "--force", slot]);
          rmSync(slot, { recursive: true, force: true });
        }
        addFeature(repo, "F-Menu", {
          ...featureTree("F-Menu"),
          "shared/nav.txt": "home\nmenu\n",
          "migrations/0001_menu.sql": "CREATE TABLE menu (id TEXT PRIMARY KEY);\n",
        });
        addFeature(repo, "F-Orders", {
          ...featureTree("F-Orders"),
          "shared/nav.txt": "home\norders\n",
          "migrations/0001_orders.sql":
            "CREATE TABLE orders (id TEXT PRIMARY KEY, menu_id TEXT REFERENCES menu(id));\n",
        });
        queue.enqueue(request("F-Menu"));
        const first = await queue.drain();
        expect(first.landed.map((item) => item.featureId)).toEqual(["F-Menu"]);
        queue.enqueue(request("F-Orders", passingSnapshot("F-Orders", ["F-Menu"])));
        const second = await queue.drain();
        expect(second.evicted).toEqual([]);
        expect(second.landed.map((item) => item.featureId)).toEqual(["F-Orders"]);
        const tip = queue.integrationSha();
        const nav = show(repo, `${tip}:shared/nav.txt`);
        expect(nav).toContain("menu");
        expect(nav).toContain("orders");
        const names = gitOk(repo, ["ls-tree", "-r", "--name-only", tip, "migrations"]).stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.endsWith(".sql"));
        expect(names.length).toBeGreaterThan(0);
        expect(names.every((file) => !path.posix.basename(file).startsWith("0001_"))).toBe(true);
        const orders = names.find((file) => file.includes("orders"));
        expect(orders).toBeTruthy();
        expect(show(repo, `${tip}:${orders ?? ""}`)).toContain("REFERENCES menu");
        const prompt = queue.engine.prompts.find((item) => item.includes("migration-ast:"));
        expect(prompt).toContain("F-Menu canonical spec");
        expect(prompt).toContain("F-Orders canonical spec");
        expect(prompt).not.toContain("SENTINEL_NOT_FOR_MODEL");
        expect(queue.runtimeState("F-Orders")).toBe("DONE");
      });
    },
    120_000,
  );

  it(
    "re-stages onto a moved integration head when compare-and-swap rejects the stale head",
    async () => {
      let moved = false;
      let synced = "";
      await withQueue(
        {
          beforeCas: ({ expectedSha }) => {
            if (moved) return;
            moved = true;
            const slot = mkdtempSync(path.join(tmpdir(), "ef-sync-"));
            try {
              gitOk(repoRef.repo, ["worktree", "add", "--detach", slot, "harness/integration"]);
              write(slot, "sync/base.txt", "SHA-2\n");
              gitOk(slot, ["add", "-A"]);
              gitOk(slot, ["commit", "-m", "task 171 base sync"]);
              synced = revParse(slot, "HEAD");
              gitOk(repoRef.repo, ["update-ref", INTEGRATION_REF, synced, expectedSha]);
            } finally {
              runGit(repoRef.repo, ["worktree", "remove", "--force", slot]);
              rmSync(slot, { recursive: true, force: true });
            }
          },
        },
        undefined,
        async ({ repo, queue }) => {
          repoRef.repo = repo;
          addFeature(repo, "F-Sync", featureTree("F-Sync"));
          queue.enqueue(request("F-Sync"));
          const report = await queue.drain();
          expect(report.landed.map((item) => item.featureId)).toEqual(["F-Sync"]);
          const tip = queue.integrationSha();
          expect(ancestor(repo, synced, tip)).toBe(true);
          expect(ancestor(repo, revParse(repo, "refs/heads/harness/f/F-Sync"), tip)).toBe(true);
          expect(show(repo, `${tip}:sync/base.txt`)).toContain("SHA-2");
          expect(show(repo, `${tip}:features/F-Sync/manifest.json`)).toContain("F-Sync");
        },
      );
    },
    120_000,
  );

  it(
    "leaves the green head untouched when the daemon stops after the gate and resumes on restart",
    async () => {
      let crashed = false;
      await withQueue(
        {
          afterGate: () => {
            if (crashed) return;
            crashed = true;
            throw new SimulatedCrash("verification");
          },
        },
        undefined,
        async ({ repo, queue }) => {
          addFeature(repo, "F-Crash", featureTree("F-Crash"));
          queue.enqueue(request("F-Crash"));
          const before = queue.integrationSha();
          await expect(queue.drain()).rejects.toThrow(/verification/);
          expect(queue.integrationSha()).toBe(before);
          expect(queue.itemStatus("F-Crash")).toBe("VERIFYING");
          const recovery = queue.recover();
          expect(recovery.requeued).toEqual(["F-Crash"]);
          expect(recovery.integrationSha).toBe(before);
          const report = await queue.drain();
          expect(report.landed.map((item) => item.featureId)).toEqual(["F-Crash"]);
          expect(queue.integrationSha()).not.toBe(before);
          expect(queue.runtimeState("F-Crash")).toBe("DONE");
        },
      );
    },
    120_000,
  );

  it(
    "reconciles a compare-and-swap that landed when the daemon stopped before the DONE row",
    async () => {
      let crashed = false;
      await withQueue(
        {
          afterCas: () => {
            if (crashed) return;
            crashed = true;
            throw new SimulatedCrash("update-ref");
          },
        },
        undefined,
        async ({ repo, queue }) => {
          addFeature(repo, "F-Cas", featureTree("F-Cas"));
          queue.enqueue(request("F-Cas"));
          const before = queue.integrationSha();
          await expect(queue.drain()).rejects.toThrow(/update-ref/);
          const moved = queue.integrationSha();
          expect(moved).not.toBe(before);
          expect(queue.itemStatus("F-Cas")).not.toBe("LANDED");
          const recovery = queue.recover();
          expect(recovery.reconciledLanded).toEqual(["F-Cas"]);
          expect(queue.runtimeState("F-Cas")).toBe("DONE");
          expect(queue.integrationSha()).toBe(moved);
          const second = await queue.drain();
          expect(second.landed).toEqual([]);
          expect(queue.integrationSha()).toBe(moved);
          expect(merges(repo)).toHaveLength(1);
        },
      );
    },
    120_000,
  );

  it(
    "blocks the queue while another holder leases harness/integration",
    async () => {
      await withQueue(undefined, undefined, async ({ root, repo, queue }) => {
        addFeature(repo, "F-Held", featureTree("F-Held"));
        queue.enqueue(request("F-Held"));
        const before = queue.integrationSha();
        const side = new DatabaseSync(path.join(root, "state.db"));
        try {
          side
            .prepare("INSERT INTO ref_leases (ref, holder, epoch, expected_sha, expires_at) VALUES (?, ?, ?, ?, ?)")
            .run(INTEGRATION_REF, "task-171", 4, before, Date.now() + 60_000);
        } finally {
          side.close();
        }
        const report = await queue.drain();
        expect(report.blocked).toBe("lease_held");
        expect(report.landed).toEqual([]);
        expect(queue.integrationSha()).toBe(before);
        expect(queue.itemStatus("F-Held")).toBe("QUEUED");
      });
    },
    120_000,
  );

  it(
    "escalates an irreconcilable contract clash to task 112 after the second eviction",
    async () => {
      const model: ProjectIntegratorModel = () => ({
        output: { blocked: true, reason: "irreconcilable cross-feature contract clash" },
      });
      await withQueue(undefined, model, async ({ repo, queue }) => {
        const slot = mkdtempSync(path.join(tmpdir(), "ef-nav-"));
        try {
          gitOk(repo, ["worktree", "add", slot, "harness/integration"]);
          write(slot, "shared/nav.txt", "home\n");
          gitOk(slot, ["add", "-A"]);
          gitOk(slot, ["commit", "-m", "nav"]);
        } finally {
          runGit(repo, ["worktree", "remove", "--force", slot]);
          rmSync(slot, { recursive: true, force: true });
        }
        addFeature(repo, "F-Menu", { ...featureTree("F-Menu"), "shared/nav.txt": "home\nmenu\n" });
        addFeature(repo, "F-Orders", { ...featureTree("F-Orders"), "shared/nav.txt": "home\norders\n" });
        queue.enqueue(request("F-Menu"));
        queue.enqueue(request("F-Orders"));
        const first = await queue.drain();
        expect(first.landed.map((item) => item.featureId)).toEqual(["F-Menu"]);
        expect(first.evicted.map((item) => item.featureId)).toEqual(["F-Orders"]);
        expect(first.evicted[0]?.evictionCount).toBe(1);
        const parked = queue.integrationSha();
        queue.enqueue(request("F-Orders"));
        const second = await queue.drain();
        expect(second.landed).toEqual([]);
        expect(second.escalations).toHaveLength(1);
        expect(second.escalations[0]?.to).toBe("task-112");
        expect(second.escalations[0]?.specs.map((spec) => spec.id).sort()).toEqual(["F-Menu", "F-Orders"]);
        expect(second.escalations[0]?.specs.map((spec) => spec.text).sort()).toEqual([
          "F-Menu canonical spec",
          "F-Orders canonical spec",
        ]);
        expect(queue.integrationSha()).toBe(parked);
        expect(queue.itemStatus("F-Orders")).toBe("ESCALATED");
      });
    },
    120_000,
  );

  it(
    "rejects a merge diff that contains a secret and keeps the green head",
    async () => {
      await withQueue(undefined, undefined, async ({ repo, queue }) => {
        const secret = ["sk", "_live_", "mergequeue"].join("");
        addFeature(repo, "F-Secret", {
          ...featureTree("F-Secret"),
          "config/keys.txt": `${secret}\n`,
        });
        const before = queue.integrationSha();
        queue.enqueue(request("F-Secret"));
        const report = await queue.drain();
        expect(report.landed).toEqual([]);
        expect(report.evicted.map((item) => item.featureId)).toEqual(["F-Secret"]);
        expect(report.evicted[0]?.trace.toLowerCase()).toContain("secret");
        expect(queue.integrationSha()).toBe(before);
      });
    },
    120_000,
  );
});
