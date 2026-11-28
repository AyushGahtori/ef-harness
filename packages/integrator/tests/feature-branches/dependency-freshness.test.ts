import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DependencyIntentAggregator,
  LocalSupplyChainGate,
  LockfileIntegrityError,
  PNPM_LOCKFILE_ONLY_ARGS,
  SharedFileDriftMonitor,
  SmartBranchFreshnessSync,
  intersectRanges,
} from "../../src/feature-branches/index.js";
import type { DependencyIntent } from "../../src/feature-branches/index.js";
import { countExclusive, isAncestor, porcelain, revParse, showFile } from "../../src/feature-branches/git.js";
import { commitIntegration, createHarness, writeSyntheticLockfile, type Harness } from "./fixture.js";

const open: Harness[] = [];

afterEach(() => {
  for (const harness of open.splice(0)) harness.close();
});

function use(): Harness {
  const harness = createHarness();
  open.push(harness);
  return harness;
}

function intent(featureId: string, packageName: string, versionRange: string, devOnly = false): DependencyIntent {
  return {
    featureId,
    packageName,
    versionRange,
    devOnly,
    rationale: `${featureId} needs ${packageName} for typed feature boundaries`,
  };
}

function aggregatorFor(harness: Harness, supplyChain = new LocalSupplyChainGate()) {
  const freshness = new SmartBranchFreshnessSync(harness.manager);
  let installs = 0;
  const aggregator = new DependencyIntentAggregator({
    repo: harness.repo,
    state: harness.state,
    worktreeRoot: path.join(harness.root, "wt"),
    branches: harness.manager,
    freshness,
    supplyChain,
    installer: {
      install(cwd: string) {
        installs += 1;
        writeSyntheticLockfile(cwd);
      },
    },
  });
  return {
    freshness,
    supplyChain,
    aggregator,
    installs: () => installs,
    close() {
      aggregator.close();
    },
  };
}

describe("dependency intent aggregation", { timeout: 30_000 }, () => {
  it("intersects compatible ranges and rejects ranges that do not overlap", () => {
    expect(intersectRanges("^3.0.0", "^3.23.0")).toBe("^3.23.0");
    expect(intersectRanges("^1.0.0", "^2.0.0")).toBeNull();
    expect(intersectRanges("file:./vendor/zod", "file:./vendor/zod")).toBe("file:./vendor/zod");
    expect(intersectRanges("file:./vendor/zod", "^3.0.0")).toBeNull();
  });

  it("serializes zod and date-fns into one integration lockfile commit", () => {
    const harness = use();
    harness.manager.openFeature({ featureId: "F-Menu", featureSlug: "F-Menu", waveId: "wave-3" });
    harness.manager.openFeature({ featureId: "F-Orders", featureSlug: "F-Orders", waveId: "wave-3" });
    const before = revParse(harness.repo, harness.manager.integrationRef);
    const gate = aggregatorFor(harness);
    const result = gate.aggregator.aggregate([
      intent("F-Menu", "zod", "^3.0.0"),
      intent("F-Orders", "zod", "^3.23.0"),
      intent("F-Orders", "date-fns", "^3.6.0"),
    ]);
    expect(result.status).toBe("applied");
    expect(result.lockfileCommand).toEqual([...PNPM_LOCKFILE_ONLY_ARGS]);
    expect(gate.installs()).toBe(1);
    expect(result.packages.map((item) => `${item.packageName}@${item.versionRange}`)).toEqual([
      "date-fns@^3.6.0",
      "zod@^3.23.0",
    ]);
    expect(result.commitSha).toBeTruthy();
    const after = revParse(harness.repo, harness.manager.integrationRef);
    expect(after).toBe(result.commitSha);
    expect(isAncestor(harness.repo, before, after)).toBe(true);
    const manifest = showFile(harness.repo, `${after}:package.json`);
    expect(manifest).toContain('"zod": "^3.23.0"');
    expect(manifest).toContain('"date-fns": "^3.6.0"');
    const lockfile = showFile(harness.repo, `${after}:pnpm-lock.yaml`);
    expect(lockfile).toContain("lockfileVersion");
    expect(lockfile).toContain("integrity:");
    expect(result.propagated.map((item) => item.action)).toEqual(["synced", "synced"]);
    expect(isAncestor(harness.repo, after, harness.manager.read("F-Menu").headSha)).toBe(true);
    expect(isAncestor(harness.repo, after, harness.manager.read("F-Orders").headSha)).toBe(true);
    gate.close();
  }, 30_000);

  it("returns an incompatible range without moving harness/integration", () => {
    const harness = use();
    const before = revParse(harness.repo, harness.manager.integrationRef);
    const gate = aggregatorFor(harness);
    const result = gate.aggregator.aggregate([intent("F-Menu", "zod", "^3.0.0"), intent("F-Orders", "zod", "^4.0.0")]);
    expect(result.status).toBe("conflict");
    expect(result.commitSha).toBeNull();
    expect(result.conflicts[0]?.packageName).toBe("zod");
    expect(result.conflicts[0]?.requests.map((request) => request.versionRange)).toEqual(["^3.0.0", "^4.0.0"]);
    expect(revParse(harness.repo, harness.manager.integrationRef)).toBe(before);
    expect(gate.installs()).toBe(0);
    gate.close();
  });

  it("denies a typosquat and an unapproved package before any lockfile write", () => {
    const harness = use();
    const before = revParse(harness.repo, harness.manager.integrationRef);
    const supply = new LocalSupplyChainGate();
    const gate = aggregatorFor(harness, supply);
    const denied = gate.aggregator.aggregate([
      intent("F-Menu", "zodx", "^3.0.0"),
      intent("F-Orders", "left-pad", "^1.0.0"),
    ]);
    expect(denied.status).toBe("denied");
    expect(denied.denials.map((item) => item.packageName).sort()).toEqual(["left-pad", "zodx"]);
    expect(denied.denials.find((item) => item.packageName === "zodx")?.reason).toContain("typosquat");
    expect(revParse(harness.repo, harness.manager.integrationRef)).toBe(before);
    const empty = gate.aggregator.aggregate([
      { ...intent("F-Menu", "zod", "^3.0.0"), rationale: "   " },
    ]);
    expect(empty.status).toBe("denied");
    supply.approve("left-pad");
    const allowed = gate.aggregator.aggregate([intent("F-Menu", "left-pad", "^1.2.0")]);
    expect(allowed.status).toBe("applied");
    expect(allowed.packages[0]?.packageName).toBe("left-pad");
    gate.close();
  });

  it("rejects a lockfile that misses integrity or points at a non-registry tarball", () => {
    const harness = use();
    const before = revParse(harness.repo, harness.manager.integrationRef);
    const freshness = new SmartBranchFreshnessSync(harness.manager);
    const aggregator = new DependencyIntentAggregator({
      repo: harness.repo,
      state: harness.state,
      worktreeRoot: path.join(harness.root, "wt"),
      branches: harness.manager,
      freshness,
      supplyChain: new LocalSupplyChainGate(),
      installer: {
        install(cwd: string) {
          fs.writeFileSync(
            path.join(cwd, "pnpm-lock.yaml"),
            "lockfileVersion: '9.0'\nzod@^3.23.0:\n  resolved: https://evil.example/zod.tgz\n",
            "utf8",
          );
        },
      },
    });
    expect(() => aggregator.aggregate([intent("F-Menu", "zod", "^3.23.0")])).toThrow(LockfileIntegrityError);
    expect(revParse(harness.repo, harness.manager.integrationRef)).toBe(before);
    aggregator.close();
  });

  it("folds an intent that arrives while the lockfile is being written into the same commit", () => {
    const harness = use();
    const freshness = new SmartBranchFreshnessSync(harness.manager);
    const box: { current: DependencyIntentAggregator | null } = { current: null };
    let installs = 0;
    box.current = new DependencyIntentAggregator({
      repo: harness.repo,
      state: harness.state,
      worktreeRoot: path.join(harness.root, "wt"),
      branches: harness.manager,
      freshness,
      supplyChain: new LocalSupplyChainGate(),
      installer: {
        install(cwd: string) {
          installs += 1;
          if (installs === 1) {
            box.current?.aggregate([intent("F-Orders", "date-fns", "^3.6.0")]);
          }
          writeSyntheticLockfile(cwd);
        },
      },
    });
    const aggregator = box.current;
    if (!aggregator) throw new Error("aggregator was not constructed");
    const before = revParse(harness.repo, harness.manager.integrationRef);
    const result = aggregator.aggregate([intent("F-Menu", "zod", "^3.23.0")]);
    expect(result.status).toBe("applied");
    expect(installs).toBe(2);
    expect(result.packages.map((item) => item.packageName)).toEqual(["date-fns", "zod"]);
    const after = revParse(harness.repo, harness.manager.integrationRef);
    expect(countExclusive(harness.repo, before, after)).toBe(1);
    expect(showFile(harness.repo, `${after}:package.json`)).toContain("date-fns");
    aggregator.close();
  });
});

describe("smart freshness and shared-file drift", { timeout: 30_000 }, () => {
  it("skips a disjoint branch, syncs a read set, and does not churn on an unrelated migration", () => {
    const harness = use();
    harness.manager.openFeature({ featureId: "F-B", featureSlug: "F-B", waveId: "wave-3" });
    const pin = harness.manager.read("F-B").pinnedBaseCommitSha;
    harness.manager.commitFeatureFiles("F-B", { "src/orders/order.ts": "export const order = 1;\n" }, "orders");
    harness.manager.registerReadSet("F-B", ["src/nav.ts"]);
    const head = harness.manager.read("F-B").headSha;
    const worktree = harness.manager.read("F-B").worktreePath ?? "";
    commitIntegration(harness.repo, harness.manager.integrationRef, { "src/menu/tags.ts": "export const tags = 1;\n" }, "menu");
    const freshness = new SmartBranchFreshnessSync(harness.manager);
    const skipped = freshness.applyDue("F-B");
    expect(skipped.action).toBe("skipped");
    expect(skipped.plan).toEqual({ action: "skip", reason: "disjoint_clean" });
    expect(harness.manager.read("F-B").headSha).toBe(head);
    expect(porcelain(worktree).trim()).toBe("");

    commitIntegration(
      harness.repo,
      harness.manager.integrationRef,
      { "migrations/20261119011500_aaaaaa_notes.sql": "CREATE TABLE notes (id TEXT);\n" },
      "unrelated migration",
    );
    expect(freshness.applyDue("F-B").action).toBe("skipped");
    expect(harness.manager.read("F-B").headSha).toBe(head);

    harness.manager.registerReadSet("F-B", ["src/nav.ts", "migrations/20261119011500_aaaaaa_notes.sql"]);
    const contract = freshness.plan("F-B");
    expect(contract).toEqual({ action: "schedule", reason: "shared_contract", at: "next_leaf_boundary" });
    const synced = freshness.applyDue("F-B");
    expect(synced.action).toBe("synced");
    expect(isAncestor(harness.repo, head, harness.manager.read("F-B").headSha)).toBe(true);
    expect(harness.manager.read("F-B").pinnedBaseCommitSha).toBe(pin);
    expect(isAncestor(harness.repo, pin, harness.manager.read("F-B").headSha)).toBe(true);
  }, 30_000);

  it("waits for the leaf boundary when a lockfile lands and never rewrites the running SHA", () => {
    const harness = use();
    harness.manager.openFeature({ featureId: "F-B", featureSlug: "F-B", waveId: "wave-3" });
    const own = harness.manager.commitFeatureFiles("F-B", { "src/orders/order.ts": "export const order = 1;\n" }, "orders");
    harness.manager.beginTurn("F-B", "leaf-1");
    const gate = aggregatorFor(harness);
    const result = gate.aggregator.aggregate([intent("F-Menu", "zod", "^3.23.0")]);
    expect(result.propagated).toEqual([{ featureId: "F-B", action: "deferred" }]);
    expect(harness.manager.read("F-B").headSha).toBe(own);
    expect(harness.manager.read("F-B").status).toBe("sync_scheduled");
    expect(porcelain(harness.manager.read("F-B").worktreePath ?? "").trim()).toBe("");
    harness.manager.endTurn("F-B", "leaf-1");
    const applied = gate.freshness.applyDue("F-B");
    expect(applied.action).toBe("synced");
    if (applied.action !== "synced") return;
    expect(applied.outcome.method).toBe("merge");
    expect(applied.outcome.pinnedBaseCommitSha).toBe(harness.manager.read("F-B").pinnedBaseCommitSha);
    expect(isAncestor(harness.repo, own, applied.outcome.newHead)).toBe(true);
    expect(revParse(harness.manager.read("F-B").worktreePath ?? harness.repo, "HEAD")).toBe(applied.outcome.newHead);
    gate.close();
  }, 30_000);

  it("holds a textual conflict at the boundary without rewriting SHAs or dirtying the worktree", () => {
    const harness = use();
    harness.manager.openFeature({ featureId: "F-B", featureSlug: "F-B", waveId: "wave-3" });
    const own = harness.manager.commitFeatureFiles("F-B", { "src/nav.ts": "export const nav = 'orders';\n" }, "orders nav");
    commitIntegration(harness.repo, harness.manager.integrationRef, { "src/nav.ts": "export const nav = 'menu';\n" }, "menu nav");
    const freshness = new SmartBranchFreshnessSync(harness.manager);
    const planned = freshness.plan("F-B");
    expect(planned).toEqual({ action: "schedule", reason: "textual_conflict", at: "next_leaf_boundary" });
    const held = freshness.applyDue("F-B");
    expect(held.action).toBe("held");
    expect(harness.manager.read("F-B").headSha).toBe(own);
    expect(harness.manager.read("F-B").status).toBe("sync_scheduled");
    const worktree = harness.manager.read("F-B").worktreePath ?? "";
    expect(porcelain(worktree).trim()).toBe("");
    expect(fs.readFileSync(path.join(worktree, "src/nav.ts"), "utf8")).toContain("orders");
  });

  it("warns when two feature branches edit the same helper outside one write scope", () => {
    const harness = use();
    harness.manager.openFeature({ featureId: "F-Menu", featureSlug: "F-Menu", waveId: "wave-3" });
    harness.manager.openFeature({ featureId: "F-Email", featureSlug: "F-Email", waveId: "wave-3" });
    harness.manager.registerWriteScope("F-Menu", ["src/menu/"]);
    harness.manager.registerWriteScope("F-Email", ["src/email/"]);
    harness.manager.commitFeatureFiles("F-Menu", { "src/shared/format.ts": "export const format = 'menu';\n" }, "menu helper");
    harness.manager.commitFeatureFiles("F-Email", { "src/shared/format.ts": "export const format = 'email';\n" }, "email helper");
    const menuTree = harness.manager.read("F-Menu").worktreePath ?? "";
    const emailTree = harness.manager.read("F-Email").worktreePath ?? "";
    fs.writeFileSync(path.join(menuTree, "src/shared/draft.ts"), "export const draft = 1;\n");
    fs.writeFileSync(path.join(emailTree, "src/shared/draft.ts"), "export const draft = 2;\n");
    const warnings = new SharedFileDriftMonitor().scan({
      repo: harness.repo,
      branches: harness.manager.listActive(),
      scopes: {
        "F-Menu": harness.manager.writeScope("F-Menu"),
        "F-Email": harness.manager.writeScope("F-Email"),
      },
    });
    const tracked = warnings.find((warning) => warning.path === "src/shared/format.ts");
    const untracked = warnings.find((warning) => warning.path === "src/shared/draft.ts");
    expect(tracked?.kind).toBe("tracked");
    expect(tracked?.featureIds).toEqual(["F-Email", "F-Menu"]);
    expect(untracked?.kind).toBe("untracked");
    expect(warnings.some((warning) => warning.path === "package.json")).toBe(false);
  });
});
