import os from "node:os";
import path from "node:path";
import { KernelPackageInstaller } from "@ef-harness/sandbox";

import { canonicalLockfile, dependenciesFromIntents, lockfileHash } from "./lockfile.js";
import type { InstallRequest, InstallResult, KernelPackageInstallerPort } from "./ports.js";

/**
 * Phase 0 install decisions go through `KernelPackageInstaller`.
 * Approved names are vetted against local registry metadata. The kernel, not
 * the worker, is the only actor allowed to install.
 */
export class Phase0KernelInstaller implements KernelPackageInstallerPort {
  readonly calls: InstallRequest[] = [];
  private readonly kernel: KernelPackageInstaller;

  constructor() {
    const root = path.join(os.tmpdir(), "ef-phase0-installer");
    this.kernel = new KernelPackageInstaller({
      actor: "kernel",
      tier: "A",
      worktreePath: root,
      storeDir: path.join(root, "store"),
      proxy: {
        profile: "kernel_installer",
        proxyUrl: "http://127.0.0.1:9",
        allowedHosts: ["registry.npmjs.org"],
      },
      jobRunner: {
        async runCommand() {
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      },
      metadata: {
        getVersion(name: string, version: string) {
          return {
            name,
            version,
            publishedAt: "2020-01-01T00:00:00.000Z",
            license: "MIT",
            integrity: "local-metadata",
            tarballUrl: null,
            scripts: {},
          };
        },
      },
      licensePolicy: { allowed: ["MIT", "Apache-2.0", "ISC"] },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      popularPackages: [],
      minAgeHours: 72,
    });
  }

  install(request: InstallRequest): InstallResult {
    this.calls.push(request);
    if (request.frozenLockfile !== true) {
      return fail("kernel installer requires pnpm install --frozen-lockfile");
    }
    if (request.offline) {
      return fail("offline registry: registry.npmjs.org unreachable");
    }
    for (const dep of request.dependencies) {
      if (!dep.approved) {
        return fail(`unapproved dependency: ${dep.name}@${dep.version}`);
      }
      if (!/^[a-z0-9@][a-z0-9._/-]*$/i.test(dep.name) || !/^\d+\.\d+\.\d+$/.test(dep.version)) {
        return fail(`unapproved dependency: ${dep.name}@${dep.version}`);
      }
    }
    const reconciliation = this.kernel.reconcileDependencyIntents(
      request.dependencies.map((dep) => ({
        taskId: request.taskId,
        packageName: dep.name,
        range: dep.version,
        version: dep.version,
        reason: "phase0 foundation",
      })),
    );
    if (reconciliation.conflicts.length > 0) {
      return fail(reconciliation.conflicts[0]?.packageName ?? "dependency conflict");
    }
    for (const dep of request.dependencies) {
      const report = this.kernel.vetDependencyIntent({
        taskId: request.taskId,
        packageName: dep.name,
        range: dep.version,
        version: dep.version,
        reason: "phase0 foundation",
      });
      if (report.decision !== "allow") {
        return fail(report.reasons[0] ?? `dependency held: ${dep.name}@${dep.version}`);
      }
    }
    const lockfileBody = canonicalLockfile(request.dependencies);
    return {
      ok: true,
      lockfileBody,
      lockfileHash: lockfileHash(lockfileBody),
      packageDependencies: dependenciesFromIntents(request.dependencies),
      error: null,
    };
  }
}

function fail(error: string): InstallResult {
  return { ok: false, lockfileBody: "", lockfileHash: "", packageDependencies: {}, error };
}
