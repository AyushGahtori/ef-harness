import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { KernelPackageInstaller, type DependencyIntent as KernelDependencyIntent } from "@ef-harness/sandbox";
import type { ParallelFeatureBranchManager } from "./branch-manager.js";
import { LockfileInstallError, LockfileIntegrityError } from "./errors.js";
import type { SmartBranchFreshnessSync } from "./freshness.js";
import { gitOk, revParse } from "./git.js";
import { commitTree, LocalRefLeaseManager, writeTree } from "./ref-lease.js";
import { assertLockfileHasNoRemoteTarball } from "./rehearsal.js";
import { intersectRanges } from "./semver.js";
import type { FeatureBranchStateDb } from "./state-db.js";
import {
  PNPM_LOCKFILE_ONLY_ARGS,
  type DependencyAggregateResult,
  type DependencyConflict,
  type DependencyDenial,
  type DependencyIntent,
  type ResolvedDependency,
  type SupplyChainGate,
} from "./types.js";
import { LocalWorktreeSlotPool } from "./worktree-pool.js";

export type { DependencyAggregateResult };

const AGGREGATOR_HOLDER = "dependency-intent-aggregator";

export interface LockfileInstaller {
  install(cwd: string): void;
}

export class PnpmLockfileOnlyInstaller implements LockfileInstaller {
  install(cwd: string): void {
    const result = runPnpm(cwd, PNPM_LOCKFILE_ONLY_ARGS);
    if (result.status !== 0) {
      throw new LockfileInstallError((result.stderr || result.stdout || "pnpm install --lockfile-only failed").trim());
    }
  }
}

/**
 * Feature workers submit intents. This aggregator is the only writer of package.json and pnpm-lock.yaml.
 * Concurrent intents become one compare-and-swap commit on harness/integration.
 */
export class DependencyIntentAggregator {
  private readonly leases: LocalRefLeaseManager;
  private readonly pool: LocalWorktreeSlotPool;
  private readonly installer: LockfileInstaller;
  private readonly kernel: KernelPackageInstaller;
  private pending: DependencyIntent[] = [];
  private draining = false;
  private serial = 0;

  constructor(options: {
    readonly repo: string;
    readonly state: FeatureBranchStateDb;
    readonly worktreeRoot: string;
    readonly branches: ParallelFeatureBranchManager;
    readonly freshness: SmartBranchFreshnessSync;
    readonly supplyChain: SupplyChainGate;
    readonly installer?: LockfileInstaller;
    readonly kernel?: KernelPackageInstaller;
  }) {
    this.repo = options.repo;
    this.branches = options.branches;
    this.freshness = options.freshness;
    this.supplyChain = options.supplyChain;
    this.installer = options.installer ?? new PnpmLockfileOnlyInstaller();
    this.kernel = options.kernel ?? kernelPackageInstaller(options.repo);
    this.leases = new LocalRefLeaseManager(options.state, options.repo);
    this.pool = new LocalWorktreeSlotPool(options.repo, options.worktreeRoot, options.branches.store);
  }

  private readonly repo: string;
  private readonly branches: ParallelFeatureBranchManager;
  private readonly freshness: SmartBranchFreshnessSync;
  private readonly supplyChain: SupplyChainGate;

  aggregate(intents: readonly DependencyIntent[]): DependencyAggregateResult {
    this.pending.push(...intents);
    if (this.draining) {
      return joinedResult(this.branches.integrationRef);
    }
    this.draining = true;
    try {
      const batch: DependencyIntent[] = [];
      while (this.pending.length > 0) batch.push(...this.pending.splice(0, this.pending.length));
      return this.apply(batch);
    } finally {
      this.draining = false;
    }
  }

  private apply(initial: readonly DependencyIntent[]): DependencyAggregateResult {
    let batch = [...initial];
    const integrationRef = this.branches.integrationRef;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const reconciled = reconcileWithKernel(batch, this.supplyChain, this.kernel);
      if (reconciled.resolved.length === 0) {
        return {
          status: reconciled.denials.length > 0 ? "denied" : "conflict",
          commitSha: null,
          integrationRef,
          packages: [],
          conflicts: reconciled.conflicts,
          denials: reconciled.denials,
          lockfileCommand: PNPM_LOCKFILE_ONLY_ARGS,
          propagated: [],
        };
      }
      const old = revParse(this.repo, integrationRef);
      this.serial += 1;
      const slot = this.pool.acquireDetached({
        slotId: `lockfile-${this.serial}`,
        sha: old,
        featureId: null,
      });
      try {
        writeManifest(slot.path, reconciled.resolved);
        this.installer.install(slot.path);
        if (this.pending.length > 0) {
          batch = batch.concat(this.pending.splice(0, this.pending.length));
          continue;
        }
        verifyLockfile(slot.path, reconciled.resolved);
        gitOk({
          repo: slot.path,
          args: ["add", "--", "package.json", "pnpm-lock.yaml"],
        });
        const tree = writeTree(slot.path);
        const message = [
          "Serialize dependency intents onto harness/integration",
          "",
          ...reconciled.resolved.map((item) => `${item.packageName}@${item.versionRange}`),
        ].join("\n");
        const next = commitTree(slot.path, tree, old, message);
        const lease = this.leases.acquire(integrationRef, AGGREGATOR_HOLDER, old);
        this.leases.advance(integrationRef, lease.holder, lease.epoch, next, old);
        const propagated = this.branches.listActive().map((feature) => {
          const applied = this.freshness.applyDue(feature.featureId);
          return { featureId: feature.featureId, action: applied.action };
        });
        return {
          status: "applied",
          commitSha: next,
          integrationRef,
          packages: reconciled.resolved,
          conflicts: reconciled.conflicts,
          denials: reconciled.denials,
          lockfileCommand: PNPM_LOCKFILE_ONLY_ARGS,
          propagated,
        };
      } finally {
        this.pool.release(slot.slotId);
      }
    }
    throw new LockfileInstallError("Dependency intents kept arriving during lockfile generation.");
  }

  close(): void {
    this.pool.close();
  }
}

function kernelPackageInstaller(repo: string): KernelPackageInstaller {
  return new KernelPackageInstaller({
    actor: "kernel",
    tier: "A",
    worktreePath: repo,
    proxy: { profile: "kernel_installer", proxyUrl: "http://127.0.0.1:9", allowedHosts: [] },
    jobRunner: {
      runCommand: () => Promise.reject(new Error("synchronous aggregation uses reconcileDependencyIntents")),
    },
    metadata: { getVersion: () => null },
    storeDir: path.join(repo, ".ef-kernel-store"),
  });
}

function toKernelIntent(intent: DependencyIntent): KernelDependencyIntent {
  return {
    taskId: intent.taskId ?? intent.featureId,
    packageName: intent.packageName,
    range: intent.versionRange,
    reason: intent.rationale,
  };
}

function reconcileWithKernel(
  intents: readonly DependencyIntent[],
  supplyChain: SupplyChainGate,
  kernel: KernelPackageInstaller,
): ReturnType<typeof reconcileIntents> {
  const local = reconcileIntents(intents, supplyChain);
  const kernelResult = kernel.reconcileDependencyIntents(intents.map(toKernelIntent));
  const ranges = new Map(kernelResult.updates.map((update) => [update.packageName, update.range]));
  return {
    resolved: local.resolved.map((item) => {
      const range = ranges.get(item.packageName);
      return range === undefined ? item : { ...item, versionRange: range };
    }),
    conflicts: local.conflicts,
    denials: local.denials,
  };
}

export function reconcileIntents(
  intents: readonly DependencyIntent[],
  supplyChain: SupplyChainGate,
): {
  readonly resolved: readonly ResolvedDependency[];
  readonly conflicts: readonly DependencyConflict[];
  readonly denials: readonly DependencyDenial[];
} {
  const groups = new Map<string, DependencyIntent[]>();
  for (const intent of intents) {
    const bucket = groups.get(intent.packageName) ?? [];
    bucket.push(intent);
    groups.set(intent.packageName, bucket);
  }
  const resolved: ResolvedDependency[] = [];
  const conflicts: DependencyConflict[] = [];
  const denials: DependencyDenial[] = [];
  for (const name of [...groups.keys()].sort((left, right) => left.localeCompare(right))) {
    const group = groups.get(name) ?? [];
    const rejected = group.flatMap((intent) => {
      const report = supplyChain.vetDependencyIntent(intent);
      return report.decision === "deny"
        ? [{ featureId: intent.featureId, packageName: intent.packageName, reason: report.reason }]
        : [];
    });
    if (rejected.length > 0) {
      denials.push(...rejected);
      continue;
    }
    const first = group[0];
    if (!first) continue;
    let merged: string | null = first.versionRange;
    for (const intent of group.slice(1)) {
      if (merged === null) break;
      merged = intersectRanges(merged, intent.versionRange);
    }
    if (merged === null) {
      conflicts.push({
        packageName: name,
        requests: group.map((intent) => ({
          featureId: intent.featureId,
          versionRange: intent.versionRange,
          rationale: intent.rationale,
          taskId: intent.taskId ?? null,
        })),
      });
      continue;
    }
    resolved.push({
      packageName: name,
      versionRange: merged,
      devOnly: group.every((intent) => intent.devOnly),
      featureIds: group.map((intent) => intent.featureId),
    });
  }
  return { resolved, conflicts, denials };
}

function writeManifest(cwd: string, packages: readonly ResolvedDependency[]): void {
  const manifestPath = path.join(cwd, "package.json");
  const manifest = fs.existsSync(manifestPath)
    ? (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>)
    : { name: "ef-feature-integration", private: true, version: "0.0.0" };
  const dependencies = record(manifest.dependencies);
  const devDependencies = record(manifest.devDependencies);
  for (const pkg of packages) {
    if (pkg.devOnly) {
      delete dependencies[pkg.packageName];
      devDependencies[pkg.packageName] = pkg.versionRange;
    } else {
      delete devDependencies[pkg.packageName];
      dependencies[pkg.packageName] = pkg.versionRange;
    }
  }
  manifest.dependencies = dependencies;
  manifest.devDependencies = devDependencies;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function record(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") entries[key] = item;
  }
  return entries;
}

function verifyLockfile(cwd: string, packages: readonly ResolvedDependency[]): void {
  const lockPath = path.join(cwd, "pnpm-lock.yaml");
  if (!fs.existsSync(lockPath)) {
    throw new LockfileIntegrityError("pnpm install --lockfile-only did not write pnpm-lock.yaml");
  }
  const text = fs.readFileSync(lockPath, "utf8");
  if (!text.includes("lockfileVersion")) {
    throw new LockfileIntegrityError("pnpm-lock.yaml is missing lockfileVersion");
  }
  assertLockfileHasNoRemoteTarball(text);
  for (const pkg of packages) {
    if (!text.includes(`${pkg.packageName}:`) && !text.includes(`${pkg.packageName}@`)) {
      throw new LockfileIntegrityError(`pnpm-lock.yaml does not contain ${pkg.packageName}`);
    }
    if (pkg.versionRange.startsWith("file:")) {
      const relative = pkg.versionRange.slice("file:".length).replace(/^\.\//, "");
      if (!fs.existsSync(path.join(cwd, relative, "package.json"))) {
        throw new LockfileIntegrityError(`file dependency ${relative} is not in the worktree`);
      }
    } else if (!/^(link:|workspace:|catalog:)/.test(pkg.versionRange) && !text.includes("integrity:")) {
      throw new LockfileIntegrityError(`${pkg.packageName} has no integrity hash`);
    }
  }
}

function joinedResult(integrationRef: string): DependencyAggregateResult {
  return {
    status: "joined",
    commitSha: null,
    integrationRef,
    packages: [],
    conflicts: [],
    denials: [],
    lockfileCommand: PNPM_LOCKFILE_ONLY_ARGS,
    propagated: [],
  };
}

function runPnpm(cwd: string, args: readonly string[]): { status: number; stdout: string; stderr: string } {
  if (process.platform === "win32") {
    const result = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      shell: false,
      env: pnpmEnv(),
    });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
  const result = spawnSync("pnpm", [...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    env: pnpmEnv(),
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function pnpmEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: "true",
    npm_config_fund: "false",
    npm_config_audit: "false",
    GIT_TERMINAL_PROMPT: "0",
  };
}
