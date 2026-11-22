import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActiveTurnSyncError,
  CasMismatchError,
  DirtyWorktreeSyncError,
  FeatureBranchError,
  HistoryRewriteRefusedError,
  IntegrationUnverifiedError,
  PruneRefusedError,
  RefLeaseHeldError,
  StaleRefLeaseError,
} from "../../src/feature-branches/index.js";
import { catFileType, commitParents, gitOk, isAncestor, porcelain, revParse, tryRevParse } from "../../src/feature-branches/git.js";
import { commitIntegration, createHarness, landFeature, type Harness } from "./fixture.js";

const open: Harness[] = [];

afterEach(() => {
  for (const harness of open.splice(0)) harness.close();
});

function use(verifier?: Parameters<typeof createHarness>[0]): Harness {
  const harness = createHarness(verifier);
  open.push(harness);
  return harness;
}

describe("parallel feature branch lifecycle", { timeout: 30_000 }, () => {
  it("opens isolated harness/f branches from verified integration", () => {
    const { repo, manager } = use();
    const integration = revParse(repo, "refs/heads/harness/integration");
    const slugs = ["F-Menu", "F-Orders", "F-Email"] as const;
    for (const slug of slugs) {
      const record = manager.openFeature({ featureId: slug, featureSlug: slug, waveId: "wave-3" });
      expect(record.ref).toBe(`refs/heads/harness/f/${slug}`);
      expect(record.baseIntegrationSha).toBe(integration);
      expect(record.headSha).toBe(integration);
      expect(record.pinnedBaseCommitSha).toBe(integration);
      expect(record.activeLeafSlots).toEqual([]);
      expect(record.behindIntegrationCount).toBe(0);
      expect(record.status).toBe("active");
      expect(record.worktreePath && fs.existsSync(record.worktreePath)).toBe(true);
    }
    expect(manager.listActive()).toHaveLength(3);
    expect(() => manager.openFeature({ featureId: "F-Menu", featureSlug: "F-Menu-2", waveId: "wave-3" })).toThrow(
      FeatureBranchError,
    );
    expect(() => manager.openFeature({ featureId: "F-Other", featureSlug: "../main", waveId: "wave-3" })).toThrow(
      /cannot be used/,
    );
  });

  it("refuses to branch when integration is unverified", () => {
    const { repo, manager } = use({ verify: () => ({ ok: false, reason: "integration is red" }) });
    expect(() => manager.openFeature({ featureId: "F-Menu", featureSlug: "F-Menu", waveId: "wave-3" })).toThrow(
      IntegrationUnverifiedError,
    );
    expect(tryRevParse(repo, "refs/heads/harness/f/F-Menu")).toBeNull();
  });

  it("refuses a direct package.json or lockfile edit and leaves the branch SHA in place", () => {
    const { repo, manager } = use();
    const record = manager.openFeature({ featureId: "F-Menu", featureSlug: "F-Menu", waveId: "wave-3" });
    expect(() => manager.commitFeatureFiles("F-Menu", { "package.json": '{"name":"menu"}\n' }, "edit manifest")).toThrow(
      /DependencyIntent/,
    );
    expect(() => manager.commitFeatureFiles("F-Menu", { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" }, "edit lock")).toThrow(
      /DependencyIntent/,
    );
    expect(() =>
      manager.commitFeatureFiles("F-Menu", { "apps/web/pnpm-lock.yaml": "lockfileVersion: '9.0'\n" }, "nested lock"),
    ).toThrow(/DependencyIntent/);
    const nested = manager.commitFeatureFiles(
      "F-Menu",
      { "apps/menu/package.json": '{"name":"menu","private":true}\n' },
      "feature package",
    );
    expect(nested).not.toBe(record.headSha);
    expect(revParse(repo, record.ref)).toBe(nested);
    expect(porcelain(record.worktreePath ?? repo).trim()).toBe("");
  });

  it("fast-forwards a feature with no commits and merge-commits a feature that diverged", () => {
    const { repo, manager } = use();
    manager.openFeature({ featureId: "F-A", featureSlug: "F-A", waveId: "wave-3" });
    manager.openFeature({ featureId: "F-B", featureSlug: "F-B", waveId: "wave-3" });
    const pinA = manager.read("F-A").pinnedBaseCommitSha;
    commitIntegration(repo, manager.integrationRef, { "src/menu/tags.ts": "export const tags = true;\n" }, "menu landed");
    const forwarded = manager.syncFromIntegration("F-A");
    expect(forwarded.method).toBe("fast-forward");
    expect(forwarded.pinnedBaseCommitSha).toBe(pinA);
    expect(manager.read("F-A").pinnedBaseCommitSha).toBe(pinA);
    expect(isAncestor(repo, forwarded.previousHead, forwarded.newHead)).toBe(true);
    expect(catFileType(repo, forwarded.previousHead)).toBe("commit");
    expect(revParse(repo, manager.read("F-A").ref)).toBe(revParse(repo, manager.integrationRef));

    const own = manager.commitFeatureFiles("F-B", { "src/orders/order.ts": "export const order = 1;\n" }, "orders");
    const pinB = manager.read("F-B").pinnedBaseCommitSha;
    const merged = manager.syncFromIntegration("F-B");
    expect(merged.method).toBe("merge");
    expect(merged.pinnedBaseCommitSha).toBe(pinB);
    expect(commitParents(repo, merged.newHead)).toEqual([own, revParse(repo, manager.integrationRef)]);
    expect(isAncestor(repo, own, merged.newHead)).toBe(true);
    expect(isAncestor(repo, pinB, merged.newHead)).toBe(true);
    expect(manager.read("F-B").headSha).toBe(merged.newHead);
  });

  it("refuses rebase and refuses to move a branch during a running leaf turn or a dirty worktree", () => {
    const { repo, manager } = use();
    manager.openFeature({ featureId: "F-B", featureSlug: "F-B", waveId: "wave-3" });
    expect(() => manager.syncFromIntegration("F-B", "rebase")).toThrow(HistoryRewriteRefusedError);
    commitIntegration(repo, manager.integrationRef, { "src/shared/clock.ts": "export const clock = 1;\n" }, "clock");
    const head = manager.read("F-B").headSha;
    const worktree = manager.read("F-B").worktreePath ?? "";
    manager.beginTurn("F-B", "leaf-1");
    expect(() => manager.syncFromIntegration("F-B")).toThrow(ActiveTurnSyncError);
    expect(revParse(repo, manager.read("F-B").ref)).toBe(head);
    expect(revParse(worktree, "HEAD")).toBe(head);
    expect(porcelain(worktree).trim()).toBe("");
    manager.endTurn("F-B", "leaf-1");
    fs.mkdirSync(path.join(worktree, "src/orders"), { recursive: true });
    fs.writeFileSync(path.join(worktree, "src/orders/draft.ts"), "export const draft = 1;\n");
    expect(() => manager.syncFromIntegration("F-B")).toThrow(DirtyWorktreeSyncError);
    expect(revParse(repo, manager.read("F-B").ref)).toBe(head);
    fs.rmSync(path.join(worktree, "src/orders/draft.ts"));
    const synced = manager.syncFromIntegration("F-B");
    expect(synced.action).toBe("synced");
    expect(isAncestor(repo, head, synced.newHead)).toBe(true);
    expect(manager.read("F-B").pinnedBaseCommitSha).toBe(head);
  });

  it("leases every harness/f update-ref and rejects a stale compare-and-swap", () => {
    const { repo, manager } = use();
    const record = manager.openFeature({ featureId: "F-A", featureSlug: "F-A", waveId: "wave-3" });
    expect(() => manager.leases.acquire(record.ref, "other-holder", record.headSha)).toThrow(RefLeaseHeldError);
    expect(() => manager.leases.acquire("refs/heads/main", "other-holder", null)).toThrow(/outside/);
    const head = revParse(repo, record.ref);
    expect(() =>
      manager.leases.advance(record.ref, record.leaseHolder, record.leaseEpoch, head, "0000000000000000000000000000000000000000"),
    ).toThrow(CasMismatchError);
    expect(revParse(repo, record.ref)).toBe(head);
    expect(() => manager.leases.advance(record.ref, record.leaseHolder, record.leaseEpoch + 9, head, head)).toThrow(
      StaleRefLeaseError,
    );
  });

  it("reconstructs a deleted ref from the last verified SHA and emits a recovery card when the object is gone", () => {
    const { repo, manager } = use();
    const record = manager.openFeature({ featureId: "F-A", featureSlug: "F-A", waveId: "wave-3" });
    const sha = manager.commitFeatureFiles("F-A", { "src/menu/tags.ts": "export const tags = true;\n" }, "tags");
    const slot = manager.pool.forFeature("F-A")[0];
    expect(slot).toBeTruthy();
    if (!slot) return;
    manager.pool.release(slot.slotId);
    manager.store.save({ ...manager.read("F-A"), worktreePath: null }, Date.now());
    const deleted = manager.read("F-A");
    expect(deleted.worktreePath).toBeNull();
    gitOk({ repo, args: ["update-ref", "-d", record.ref, sha] });
    const recovered = manager.recoverMissingRef("F-A");
    expect(recovered.recovered).toBe(true);
    expect(recovered.sha).toBe(sha);
    expect(revParse(repo, record.ref)).toBe(sha);
    expect(catFileType(repo, sha)).toBe("commit");

    const again = manager.pool.forFeature("F-A")[0];
    if (!again) throw new Error("recovery did not restore a worktree");
    manager.pool.release(again.slotId);
    const missing = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    manager.store.save({ ...manager.read("F-A"), verifiedHeadSha: missing, worktreePath: null }, Date.now());
    gitOk({ repo, args: ["update-ref", "-d", record.ref, sha] });
    const card = manager.recoverMissingRef("F-A");
    expect(card.recovered).toBe(false);
    expect(card.card?.kind).toBe("recovery_card");
    expect(card.card?.lastVerifiedSha).toBe(missing);
    expect(manager.read("F-A").status).toBe("missing_ref");
    expect(tryRevParse(repo, record.ref)).toBeNull();
  });

  it("prunes a landed ref only after it is reachable and no leaf slot is running", () => {
    const { repo, manager } = use();
    manager.openFeature({ featureId: "F-A", featureSlug: "F-A", waveId: "wave-3" });
    const sha = manager.commitFeatureFiles("F-A", { "src/menu/tags.ts": "export const tags = true;\n" }, "tags");
    expect(() => manager.pruneLanded("F-A")).toThrow(PruneRefusedError);
    const landed = landFeature(repo, manager.read("F-A").ref, manager.integrationRef);
    expect(isAncestor(repo, sha, landed)).toBe(true);
    manager.beginTurn("F-A", "leaf-1");
    manager.markMergeQueueLanded("F-A", landed);
    expect(manager.read("F-A").status).toBe("landed");
    expect(manager.read("F-A").landedByTask).toBe(111);
    expect(() => manager.pruneLanded("F-A")).toThrow(/Leaf worktree/);
    manager.releaseLeaf("F-A", "leaf-1");
    manager.pruneLanded("F-A");
    expect(manager.read("F-A").status).toBe("pruned");
    expect(tryRevParse(repo, "refs/heads/harness/f/F-A")).toBeNull();
    expect(manager.pool.forFeature("F-A")).toEqual([]);
    expect(catFileType(repo, sha)).toBe("commit");
  });
});
