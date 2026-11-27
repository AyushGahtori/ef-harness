import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GitIntegrationRepo, runGit, writeTree } from "../../src/phase0/git-repo.js";
import { buildGate0Receipt, wave1MayStart } from "../../src/phase0/schema.js";
import type { Gate0Evaluation } from "../../src/phase0/verifier.js";
import { rmTemp, seedWebRepo, verifierFor } from "./support.js";

const roots: string[] = [];
const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  for (const root of roots.splice(0)) await rmTemp(root);
});

const active = ["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"];

describe("FoundationGate0Verifier", () => {
  it("passes a real integration repo and unlocks Wave 1 only for that sha", async () => {
    const root = await track();
    const { repo, lockfileHash } = await seedWebRepo(root);
    const { verifier, testEnv, cas } = verifierFor(repo);
    disposers.push(() => testEnv.dispose());
    const evaluation = await verifier.verify(input(lockfileHash));
    expect(evaluation.status).toBe("PASS");
    expect(evaluation.checks.find((check) => check.id === "unit_smoke")?.status).toBe("pass");
    expect(evaluation.checks.find((check) => check.id === "template_clone_smoke")?.status).toBe("pass");
    expect(evaluation.checks.find((check) => check.id === "playwright_smoke")?.status).toBe("pass");
    expect(evaluation.checks.find((check) => check.id === "process_audit")?.detail).toContain("0 leaked");
    expect(evaluation.templateDbHash).not.toBe("none");
    const port = Number(evaluation.commands.find((command) => command.id === "test_env")?.command.match(/:(\d+)/)?.[1]);
    expect(port).toBeGreaterThanOrEqual(41000);
    expect(port).toBeLessThanOrEqual(48999);
    const head = await repo.head();
    const receipt = receiptFor(evaluation, head);
    expect(wave1MayStart(receipt, head)).toBe(true);
    expect(receipt.styleguideThumbnail?.route).toBe("/__styleguide");
    expect(receipt.commands.every((command) => command.exitCode === 0 && command.durationMs >= 0)).toBe(true);
    const preview = cas.get(receipt.styleguideThumbnail?.casId ?? "");
    expect(preview?.[0]).toBe(137);
    expect(preview?.[1]).toBe(80);
    expect(receipt.styleguideThumbnail?.viewport).toBe("1440");
    expect(evaluation.screenshotCasIds).toHaveLength(2);
    expect(evaluation.exposedExportsMap["src/domain/index.ts"]).toContain("domainReady");
  }, 120_000);

  it("hard-blocks Wave 1 on typecheck, smoke, secrets, a dirty tree, a leaked process, and a bad migration", async () => {
    await expectFailure("typecheck", async (repo) => {
      const { verifier, testEnv } = verifierFor(repo, { exits: new Map([["typecheck", 1]]) });
      disposers.push(() => testEnv.dispose());
      return verifier.verify(input(null));
    }, "typecheck_failed", "P0.1");

    await expectFailure("smoke", async (repo) => {
      await writeTree(repo.root, { "tests/phase0/scaffold-smoke.mjs": "process.stderr.write('nope\\n'); process.exit(1);\n" });
      await repo.commitAll(repo.root, "phase0: break smoke");
      const { verifier, testEnv } = verifierFor(repo);
      disposers.push(() => testEnv.dispose());
      return verifier.verify(input(null));
    }, "smoke_failed", "P0.1");

    await expectFailure("secret", async (repo) => {
      const value = ["live", "k"].join("") + "x".repeat(16);
      await writeTree(repo.root, { ".env": `API_KEY=${value}\n` });
      await repo.commitAll(repo.root, "phase0: accidental env");
      const { verifier, testEnv } = verifierFor(repo);
      disposers.push(() => testEnv.dispose());
      return verifier.verify(input(null));
    }, "secret_leak", "P0.1");

    await expectFailure("dirty", async (repo) => {
      await writeTree(repo.root, { "notes.txt": "uncommitted\n" });
      const { verifier, testEnv } = verifierFor(repo);
      disposers.push(() => testEnv.dispose());
      return verifier.verify(input(null));
    }, "dirty_tree", "P0.1");

    await expectFailure("leak", async (repo) => {
      const { verifier, testEnv } = verifierFor(repo, { leakTeardowns: 1 });
      disposers.push(() => testEnv.dispose());
      return verifier.verify(input(null));
    }, "leaked_process", "P0.6");

    await expectFailure("migration", async (repo) => {
      await writeTree(repo.root, { "db/migrations/0001_up.sql": "NOT SQL AT ALL;\n" });
      await repo.commitAll(repo.root, "phase0: bad migration");
      const { verifier, testEnv } = verifierFor(repo);
      disposers.push(() => testEnv.dispose());
      return verifier.verify(input(null));
    }, "migration_failed", "P0.2");
  }, 120_000);

  it("fails styleguide token and page errors and skips them when P0.4 is absent", async () => {
    const root = await track();
    const { repo } = await seedWebRepo(root);
    await writeTree(repo.root, { "design/tokens.json": "{}\n" });
    await repo.commitAll(repo.root, "phase0: broken tokens");
    const { verifier, testEnv } = verifierFor(repo);
    disposers.push(() => testEnv.dispose());
    const broken = await verifier.verify(input(null));
    expect(broken.failureKind).toBe("token_lint_failed");
    expect(broken.failingTaskId).toBe("P0.4");
    expect(broken.checks.find((check) => check.id === "token_lint")?.status).toBe("fail");

    const cleanRoot = await track();
    const clean = await seedWebRepo(cleanRoot);
    const second = verifierFor(clean.repo);
    disposers.push(() => second.testEnv.dispose());
    const skipped = await second.verifier.verify({ ...input(clean.lockfileHash), activeTaskIds: ["P0.1", "P0.2", "P0.5", "P0.6", "P0.7"], capabilities: { database: true, auth: false, ui: false } });
    expect(skipped.checks.find((check) => check.id === "styleguide")?.status).toBe("not_applicable");
    expect(skipped.checks.find((check) => check.id === "playwright_smoke")?.status).toBe("not_applicable");
    expect(skipped.status).toBe("PASS");
  }, 120_000);

  it("quarantines pre-existing brownfield failures and rejects a new red test", async () => {
    const root = await track();
    const repo = await GitIntegrationRepo.init(root);
    await writeTree(repo.root, {
      "src/legacy.mjs": "process.stdout.write('legacy_ok\\n');\n",
      "scripts/phase0/lint.mjs": "process.stdout.write('lint ok\\n');\n",
      "scripts/phase0/build.mjs": "process.stdout.write('build ok\\n');\n",
    });
    await repo.commitAll(repo.root, "phase0: existing brownfield");
    const { verifier, testEnv } = verifierFor(repo);
    disposers.push(() => testEnv.dispose());
    const baseline = {
      async run(): Promise<{ results: { id: string; status: "pass" | "fail"; preExisting: boolean }[] }> {
        return {
          results: [
            { id: "known-fail-1", status: "fail", preExisting: true },
            { id: "known-fail-2", status: "fail", preExisting: true },
            { id: "known-fail-3", status: "fail", preExisting: true },
            { id: "known-fail-4", status: "fail", preExisting: true },
            { id: "legacy-unit", status: "pass", preExisting: false },
          ],
        };
      },
    };
    const passed = await verifier.verify({
      activeTaskIds: ["P0.B1", "P0.B2"],
      capabilities: { database: false, auth: false, ui: false },
      expectedLockfileHash: null,
      playwrightBrowserAvailable: true,
      baseline,
      brownfield: true,
    });
    expect(passed.status).toBe("PASS");
    expect(passed.quarantine).toEqual(["known-fail-1", "known-fail-2", "known-fail-3", "known-fail-4"]);

    const regressed = await verifier.verify({
      activeTaskIds: ["P0.B1", "P0.B2"],
      capabilities: { database: false, auth: false, ui: false },
      expectedLockfileHash: null,
      playwrightBrowserAvailable: true,
      baseline: {
        async run() {
          return { results: [{ id: "legacy-unit", status: "fail" as const, preExisting: false }] };
        },
      },
      brownfield: true,
    });
    expect(regressed.status).toBe("FAIL");
    expect(regressed.failureKind).toBe("baseline_failed");
    expect(wave1MayStart(receiptFor(regressed, await repo.head()), await repo.head())).toBe(false);
  }, 120_000);

  it("aborts a conflicting merge and leaves harness/integration on the previous commit", async () => {
    const root = await track();
    const repo = await GitIntegrationRepo.init(root);
    const slotA = path.join(os.tmpdir(), path.basename(root) + "-a");
    const slotB = path.join(os.tmpdir(), path.basename(root) + "-b");
    disposers.push(async () => {
      await repo.removeWorktree(slotA, "harness/t/a/1");
      await repo.removeWorktree(slotB, "harness/t/b/1");
    });
    await repo.addWorktree("harness/t/a/1", slotA);
    await repo.addWorktree("harness/t/b/1", slotB);
    await writeTree(slotA, { "README.md": "alpha\n" });
    await writeTree(slotB, { "README.md": "beta\n" });
    await repo.commitAll(slotA, "phase0: alpha");
    await repo.commitAll(slotB, "phase0: beta");
    const merged = await repo.mergeBranch("harness/t/a/1", "A");
    await expect(repo.mergeBranch("harness/t/b/1", "B")).rejects.toMatchObject({ code: "merge_failed" });
    expect(await repo.head()).toBe(merged.sha);
    expect(await repo.branch()).toBe("harness/integration");
    expect((await repo.porcelain()).trim()).toBe("");
    const status = await runGit(repo.root, ["status"]);
    expect(status.stdout.toLowerCase()).not.toContain("unmerged");
  }, 30_000);
});

async function track(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-p0-gate-"));
  roots.push(root);
  return root;
}

function input(expectedLockfileHash: string | null) {
  return {
    activeTaskIds: active,
    capabilities: { database: true, auth: true, ui: true },
    expectedLockfileHash,
    playwrightBrowserAvailable: true,
    baseline: null,
    brownfield: false,
  };
}

function receiptFor(evaluation: Gate0Evaluation, sha: string) {
  return buildGate0Receipt({
    projectId: "web",
    status: evaluation.status,
    integrationSha: sha,
    repairAttempts: 0,
    commands: evaluation.commands,
    checks: evaluation.checks,
    failingTaskId: evaluation.failingTaskId,
    failureKind: evaluation.failureKind,
    styleguideThumbnail: evaluation.styleguideThumbnail,
    escalated: false,
    quarantine: evaluation.quarantine,
    recordedAt: 1,
  });
}

async function expectFailure(
  name: string,
  run: (repo: GitIntegrationRepo) => Promise<Gate0Evaluation>,
  failureKind: string,
  owner: string,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `ef-p0-${name}-`));
  roots.push(root);
  const { repo } = await seedWebRepo(root);
  const evaluation = await run(repo);
  expect(evaluation.status).toBe("FAIL");
  expect(evaluation.failureKind).toBe(failureKind);
  expect(evaluation.failingTaskId).toBe(owner);
  const head = await repo.head();
  expect(wave1MayStart(receiptFor(evaluation, head), head)).toBe(false);
}
