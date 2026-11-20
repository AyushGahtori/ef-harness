import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DiskLane,
  KernelPackageInstaller,
  LockfileIntegrityError,
  LockfileMutationError,
  POPULAR_PACKAGES,
  RegistryProfileError,
  SandboxRedTeamError,
  TierCInstallDenied,
  WorkerDirectInstallDenied,
  alignStoreWithWorktree,
  checkTyposquat,
  chmodWritable,
  isWorkerPackageManagerInstall,
  reconcileDependencyIntents,
  spawnInstallerCommand,
  verifyLockfileIntegrity,
  type InstallerCommandRequest,
  type InstallerCommandResult,
  type InstallerJobRunner,
  type KernelInstallerProxy,
  type KernelPackageInstallerOptions,
  type PackageVersionMetadata,
} from "../../src/installer/index.js";

const NOW = new Date("2026-11-20T00:00:00.000Z");
const OLD = "2026-01-01T00:00:00.000Z";
const YOUNG = "2026-11-19T23:00:00.000Z";
const REGISTRIES = ["registry.npmjs.org", "registry.yarnpkg.com", "pypi.org", "files.pythonhosted.org"];

const originalFetch = globalThis.fetch;
let registryFetches = 0;

beforeAll(() => {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (/registry\.npmjs\.org|registry\.yarnpkg\.com|pypi\.org|files\.pythonhosted\.org|npmjs\.com/i.test(url)) {
      registryFetches += 1;
      throw new Error(`live registry call: ${url}`);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  expect(registryFetches).toBe(0);
});

function sha512(text: string): string {
  return `sha512-${createHash("sha512").update(text).digest("base64")}`;
}

function integrityFile(integrity: string): string {
  return integrity.replace(/[^A-Za-z0-9]/g, "_");
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ef-installer-"));
}

function removeTemp(directory: string): void {
  if (!fs.existsSync(directory)) return;
  chmodWritable(directory);
  fs.rmSync(directory, { recursive: true, force: true });
}

function proxy(profile: KernelInstallerProxy["profile"] = "kernel_installer"): KernelInstallerProxy {
  return { profile, proxyUrl: "http://127.0.0.1:4019", allowedHosts: REGISTRIES };
}

function metadata(partial: {
  name: string;
  version: string;
  publishedAt?: string;
  license?: string | null;
  scripts?: PackageVersionMetadata["scripts"];
  packageDir?: string;
  tarballUrl?: string | null;
}): PackageVersionMetadata {
  const record: PackageVersionMetadata = {
    name: partial.name,
    version: partial.version,
    publishedAt: partial.publishedAt ?? OLD,
    license: partial.license === undefined ? "MIT" : partial.license,
    integrity: sha512(`${partial.name}@${partial.version}`),
    tarballUrl:
      partial.tarballUrl === undefined
        ? `https://registry.npmjs.org/${partial.name.replace("/", "%2f")}/-/${partial.name.split("/").pop()}-${partial.version}.tgz`
        : partial.tarballUrl,
    scripts: partial.scripts ?? {},
  };
  return partial.packageDir ? { ...record, packageDir: partial.packageDir } : record;
}

function source(packages: readonly PackageVersionMetadata[]) {
  return {
    downloads: 0,
    getVersion(name: string, version: string): PackageVersionMetadata | null {
      return packages.find((item) => item.name === name && item.version === version) ?? null;
    },
    listVersions(name: string): readonly PackageVersionMetadata[] {
      return packages.filter((item) => item.name === name);
    },
    readTarball(): never {
      this.downloads += 1;
      throw new Error("tarball download is not allowed before vetting passes");
    },
  };
}

function recordingRunner(
  impl?: (request: InstallerCommandRequest) => Promise<InstallerCommandResult>,
): InstallerJobRunner & { readonly calls: InstallerCommandRequest[] } {
  const calls: InstallerCommandRequest[] = [];
  return {
    calls,
    async runCommand(request) {
      calls.push(request);
      if (impl) return impl(request);
      if (request.role === "red_team_probe") return { exitCode: 2, stdout: "", stderr: "EPERM" };
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

function writePnpm(lockfile: string, blocks: string): void {
  fs.writeFileSync(lockfile, `lockfileVersion: '9.0'\n\npackages:\n${blocks}`);
}

function pnpmPackage(name: string, version: string, integrity: string, tarball?: string): string {
  const url = tarball ? `, tarball: ${tarball}` : "";
  return `  '${name}@${version}':\n    resolution: {integrity: ${integrity}${url}}\n`;
}

function installerOptions(
  root: string,
  packages: readonly PackageVersionMetadata[],
  runner: InstallerJobRunner,
  overrides: Partial<KernelPackageInstallerOptions> = {},
): KernelPackageInstallerOptions {
  return {
    actor: "kernel",
    tier: "A",
    worktreePath: root,
    proxy: proxy(),
    jobRunner: runner,
    metadata: source(packages),
    storeDir: path.join(root, "pnpm-store"),
    now: () => NOW,
    licensePolicy: { allowed: ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"] },
    diskLane: new DiskLane(),
    secretRoots: [path.join(root, "secret-home", ".ssh")],
    ...overrides,
  };
}

describe("supply-chain vetting", () => {
  it("bundles at least 5000 popular npm and PyPI names", () => {
    expect(POPULAR_PACKAGES.length).toBeGreaterThanOrEqual(5000);
    expect(POPULAR_PACKAGES).toContain("express");
    expect(POPULAR_PACKAGES).toContain("lodash");
    expect(POPULAR_PACKAGES).toContain("react-dom");
    expect(POPULAR_PACKAGES).toContain("requests");
    expect(POPULAR_PACKAGES).toContain("numpy");
  });

  it("holds versions published fewer than 72 hours ago and allows older versions", () => {
    const packages = [
      metadata({ name: "left-pad", version: "1.0.0", publishedAt: YOUNG }),
      metadata({ name: "right-pad", version: "1.0.0", publishedAt: new Date(NOW.getTime() - 72 * 3_600_000).toISOString() }),
    ];
    const installer = new KernelPackageInstaller(
      installerOptions(tempDir(), packages, recordingRunner(), { minAgeHours: 72 }),
    );
    const held = installer.vetDependencyIntent({
      taskId: "T1",
      packageName: "left-pad",
      range: "1.0.0",
      reason: "padding",
    });
    expect(held.decision).toBe("hold");
    expect(held.age.held).toBe(true);
    expect(held.age.minAgeHours).toBe(72);
    expect(held.age.ageHours).toBeLessThan(72);
    const allowed = installer.vetDependencyIntent({
      taskId: "T2",
      packageName: "right-pad",
      range: "1.0.0",
      reason: "padding",
    });
    expect(allowed.age.held).toBe(false);
    expect(allowed.decision).toBe("allow");
  });

  it("blocks high and critical CVEs unless the advisory id is explicitly waived", () => {
    const packages = [metadata({ name: "marked", version: "4.0.0" }), metadata({ name: "marked", version: "4.0.1" })];
    const installer = new KernelPackageInstaller(
      installerOptions(tempDir(), packages, recordingRunner(), {
        advisories: {
          lookup: () => [
            { id: "GHSA-high", packageName: "marked", severity: "high", range: ">=4.0.0 <4.0.1" },
            { id: "GHSA-low", packageName: "marked", severity: "moderate", range: ">=4.0.0 <9.0.0" },
          ],
        },
      }),
    );
    const blocked = installer.vetDependencyIntent({
      taskId: "T1",
      packageName: "marked",
      range: "4.0.0",
      reason: "markdown",
    });
    expect(blocked.decision).toBe("deny");
    expect(blocked.cveBlocked).toBe(true);
    expect(blocked.vulnerabilities.some((finding) => finding.id === "GHSA-high" && finding.blocking)).toBe(true);
    const waived = installer.vetDependencyIntent({
      taskId: "T2",
      packageName: "marked",
      range: "4.0.0",
      reason: "waived markdown",
      waivedAdvisories: ["GHSA-high"],
    });
    expect(waived.cveBlocked).toBe(false);
    expect(waived.vulnerabilities.some((finding) => finding.id === "GHSA-low" && !finding.blocking)).toBe(true);
    const fixed = installer.vetDependencyIntent({
      taskId: "T3",
      packageName: "marked",
      range: "4.0.1",
      reason: "fixed markdown",
    });
    expect(fixed.cveBlocked).toBe(false);
  });

  it("detects expresss, 1odash, loadsh, lodash-js, and react-domm before any tarball download", () => {
    const registry = source([
      metadata({ name: "expresss", version: "1.0.0", scripts: { postinstall: "node steal.js" } }),
    ]);
    const installer = new KernelPackageInstaller(
      installerOptions(tempDir(), [], recordingRunner(), { metadata: registry }),
    );
    expect(checkTyposquat("express")?.reason).toBeUndefined();
    expect(checkTyposquat("expresss")).toMatchObject({ similarTo: "express", reason: "edit-distance", distance: 1 });
    expect(checkTyposquat("1odash")).toMatchObject({ similarTo: "lodash", reason: "homoglyph" });
    expect(checkTyposquat("loadsh")).toMatchObject({ similarTo: "lodash", reason: "edit-distance", distance: 1 });
    expect(checkTyposquat("lodash-js")).toMatchObject({ similarTo: "lodash", reason: "delimiter" });
    expect(checkTyposquat("react-domm")).toMatchObject({ similarTo: "react-dom", reason: "edit-distance" });
    expect(checkTyposquat("@evil/express")).toMatchObject({ similarTo: "express", reason: "scope-confusion" });
    expect(checkTyposquat("@types/react")).toBeNull();
    const report = installer.vetDependencyIntent({
      taskId: "T9",
      packageName: "expresss",
      range: "1.0.0",
      reason: "web server",
    });
    expect(report.decision).toBe("deny");
    expect(report.typosquat?.similarTo).toBe("express");
    expect(registry.downloads).toBe(0);
    expect(registryFetches).toBe(0);
  });

  it("flags copyleft, unknown, and missing SPDX licenses and allows MIT OR Apache-2.0", () => {
    const packages = [
      metadata({ name: "gpl-thing", version: "1.0.0", license: "GPL-3.0-only" }),
      metadata({ name: "or-thing", version: "1.0.0", license: "MIT OR Apache-2.0" }),
      metadata({ name: "and-thing", version: "1.0.0", license: "(MIT AND GPL-3.0-only)" }),
      metadata({ name: "mystery", version: "1.0.0", license: "NotARealLicense" }),
      metadata({ name: "empty-lic", version: "1.0.0", license: null }),
    ];
    const installer = new KernelPackageInstaller(installerOptions(tempDir(), packages, recordingRunner()));
    expect(installer.vetDependencyIntent({ taskId: "A", packageName: "gpl-thing", range: "1.0.0", reason: "a" }).license.status).toBe("copyleft");
    expect(installer.vetDependencyIntent({ taskId: "B", packageName: "or-thing", range: "1.0.0", reason: "b" }).license).toMatchObject({
      status: "allowed",
      flagged: false,
    });
    expect(installer.vetDependencyIntent({ taskId: "C", packageName: "and-thing", range: "1.0.0", reason: "c" }).license.flagged).toBe(true);
    expect(installer.vetDependencyIntent({ taskId: "D", packageName: "mystery", range: "1.0.0", reason: "d" }).license.status).toBe("unknown");
    expect(installer.vetDependencyIntent({ taskId: "E", packageName: "empty-lic", range: "1.0.0", reason: "e" }).license.status).toBe("missing");
  });
});

describe("lockfile integrity", () => {
  it("rejects rogue tarball hosts, missing SHA-512 digests, and mismatched bytes", () => {
    const root = tempDir();
    try {
      const good = sha512("ok-pkg@2.0.0");
      const rogue = path.join(root, "pnpm-lock.yaml");
      writePnpm(
        rogue,
        pnpmPackage("evil-tar", "1.0.0", sha512("evil-tar@1.0.0"), "https://evil.example/evil-tar.tgz"),
      );
      expect(() => verifyLockfileIntegrity(rogue)).toThrow(LockfileIntegrityError);
      try {
        verifyLockfileIntegrity(rogue);
      } catch (error) {
        expect(error).toBeInstanceOf(LockfileIntegrityError);
        expect((error as LockfileIntegrityError).failures.some((failure) => failure.code === "rogue_tarball_url")).toBe(true);
      }
      const missing = path.join(root, "missing.yaml");
      fs.writeFileSync(
        missing,
        "lockfileVersion: '9.0'\n\npackages:\n  'bare@1.0.0':\n    resolution: {tarball: https://registry.npmjs.org/bare/-/bare-1.0.0.tgz}\n",
      );
      fs.copyFileSync(missing, path.join(root, "pnpm-lock.yaml"));
      try {
        verifyLockfileIntegrity(path.join(root, "pnpm-lock.yaml"));
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(LockfileIntegrityError);
        expect((error as LockfileIntegrityError).failures.some((failure) => failure.code === "missing_sha512")).toBe(true);
      }
      const npmLock = path.join(root, "package-lock.json");
      fs.writeFileSync(
        npmLock,
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { name: "app" },
            "node_modules/evil-tar": {
              version: "1.0.0",
              resolved: "https://not-a-registry.example/evil-tar.tgz",
              integrity: sha512("evil"),
            },
          },
        }),
      );
      expect(() => verifyLockfileIntegrity(npmLock)).toThrow(LockfileIntegrityError);
      const mismatch = path.join(root, "pnpm-lock.yaml");
      writePnpm(mismatch, pnpmPackage("ok-pkg", "2.0.0", good));
      expect(() =>
        verifyLockfileIntegrity(mismatch, { bytesFor: () => Buffer.from("other-bytes") }),
      ).toThrow(LockfileIntegrityError);
      const clean = path.join(root, "clean-lock.yaml");
      fs.writeFileSync(clean, fs.readFileSync(mismatch));
      fs.copyFileSync(clean, path.join(root, "pnpm-lock.yaml"));
      const report = verifyLockfileIntegrity(path.join(root, "pnpm-lock.yaml"));
      expect(report.ok).toBe(true);
      expect(report.packages[0]?.integrity).toBe(good);
    } finally {
      removeTemp(root);
    }
  });
});

describe("dependency intent reconciliation", () => {
  it("merges compatible ranges to ^3.23.0 and rejects incompatible majors with task ids and reasons", () => {
    const compatible = reconcileDependencyIntents([
      { taskId: "T1", packageName: "zod", range: "^3.22.0", reason: "parse config" },
      { taskId: "T2", packageName: "zod", range: "^3.23.0", reason: "stricter object" },
    ]);
    expect(compatible.conflicts).toEqual([]);
    expect(compatible.updates).toEqual([
      {
        packageName: "zod",
        range: "^3.23.0",
        taskIds: ["T1", "T2"],
        reasons: ["parse config", "stricter object"],
      },
    ]);
    const conflict = reconcileDependencyIntents([
      { taskId: "T3", packageName: "zod", range: "^3.0.0", reason: "legacy parser" },
      { taskId: "T4", packageName: "zod", range: "^4.0.0", reason: "v4 migration" },
    ]);
    expect(conflict.updates).toEqual([]);
    expect(conflict.conflicts).toEqual([
      {
        packageName: "zod",
        ranges: [
          { taskId: "T3", range: "^3.0.0", reason: "legacy parser" },
          { taskId: "T4", range: "^4.0.0", reason: "v4 migration" },
        ],
      },
    ]);
  });

  it("writes one package.json and lockfile update for a reconciled range and leaves conflicts untouched", async () => {
    const root = tempDir();
    try {
      const packageJson = path.join(root, "package.json");
      const lockfile = path.join(root, "pnpm-lock.yaml");
      fs.writeFileSync(packageJson, `${JSON.stringify({ name: "app", dependencies: {} }, null, 2)}\n`);
      const zod = metadata({ name: "zod", version: "3.23.4" });
      writePnpm(lockfile, "");
      const beforeJson = fs.readFileSync(packageJson, "utf8");
      const beforeLock = fs.readFileSync(lockfile, "utf8");
      const runner = recordingRunner();
      const installer = new KernelPackageInstaller(installerOptions(root, [zod], runner));
      const conflicted = await installer.applyReconciledIntents({
        packageJsonPath: packageJson,
        lockfilePath: lockfile,
        intents: [
          { taskId: "T3", packageName: "zod", range: "^3.0.0", reason: "legacy parser" },
          { taskId: "T4", packageName: "zod", range: "^4.0.0", reason: "v4 migration" },
        ],
      });
      expect(conflicted.status).toBe("conflict");
      expect(fs.readFileSync(packageJson, "utf8")).toBe(beforeJson);
      expect(fs.readFileSync(lockfile, "utf8")).toBe(beforeLock);
      expect(runner.calls).toHaveLength(0);
      const applied = await installer.applyReconciledIntents({
        packageJsonPath: packageJson,
        lockfilePath: lockfile,
        intents: [
          { taskId: "T1", packageName: "zod", range: "^3.22.0", reason: "parse config" },
          { taskId: "T2", packageName: "zod", range: "^3.23.0", reason: "stricter object" },
        ],
      });
      expect(applied.status).toBe("installed");
      const json = JSON.parse(fs.readFileSync(packageJson, "utf8")) as { dependencies: Record<string, string> };
      expect(json.dependencies.zod).toBe("^3.23.0");
      const lockText = fs.readFileSync(lockfile, "utf8");
      expect(lockText.match(/zod@3\.23\.4/g)).toHaveLength(1);
      expect(runner.calls).toHaveLength(1);
      expect(runner.calls[0]?.args).toContain("--frozen-lockfile");
    } finally {
      removeTemp(root);
    }
  });
});

describe("kernel package installer", () => {
  it("blocks an unapproved postinstall canary and pins the approval card to the exact version", async () => {
    const root = tempDir();
    try {
      const canary = path.join(root, "canary-created.txt");
      const pkgDir = path.join(root, "evil-pkg");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(
        path.join(pkgDir, "postinstall.js"),
        `const fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(canary)}, "ran");\n`,
      );
      const evil = metadata({
        name: "evil-pkg",
        version: "1.2.3",
        scripts: { postinstall: "node postinstall.js" },
        packageDir: pkgDir,
        tarballUrl: "file:./evil-pkg",
      });
      const lockfile = path.join(root, "pnpm-lock.yaml");
      writePnpm(lockfile, "  'evil-pkg@1.2.3':\n    resolution: {tarball: file:./evil-pkg}\n");
      const runner = recordingRunner(async () => {
        fs.writeFileSync(canary, "runner-executed");
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const installer = new KernelPackageInstaller(installerOptions(root, [evil], runner));
      const outcome = await installer.installLockedDependencies({ lockfilePath: lockfile });
      expect(outcome.status).toBe("approval_required");
      if (outcome.status !== "approval_required") return;
      expect(outcome.cards[0]).toMatchObject({
        type: "InstallScriptApprovalRequired",
        inboxType: "Approval",
        packageAtVersion: "evil-pkg@1.2.3",
        prompt: "Approve this version once",
        actions: ["Approve this version once", "Deny"],
      });
      expect(outcome.cards[0]?.scriptPreview).toContain("postinstall");
      expect(outcome.cards[0]?.scriptPreview).toContain("canary-created.txt");
      expect(outcome.cards[0]?.message).toContain("does not approve any other version");
      expect(fs.existsSync(canary)).toBe(false);
      expect(runner.calls).toHaveLength(0);
    } finally {
      removeTemp(root);
    }
  });

  it("does not reuse an allowBuilds pin for the next patch version", async () => {
    const root = tempDir();
    try {
      const previous = metadata({
        name: "esbuild",
        version: "0.25.0",
        scripts: { postinstall: "node install.js" },
      });
      const next = metadata({
        name: "esbuild",
        version: "0.25.1",
        scripts: { postinstall: "node install.js" },
        tarballUrl: "file:./esbuild",
      });
      const lockfile = path.join(root, "pnpm-lock.yaml");
      writePnpm(lockfile, "  'esbuild@0.25.1':\n    resolution: {tarball: file:./esbuild}\n");
      const installer = new KernelPackageInstaller(
        installerOptions(root, [previous, next], recordingRunner(), { allowBuilds: ["esbuild@0.25.0"] }),
      );
      const outcome = await installer.installLockedDependencies({ lockfilePath: lockfile });
      expect(outcome.status).toBe("approval_required");
      if (outcome.status !== "approval_required") return;
      expect(outcome.cards[0]?.packageAtVersion).toBe("esbuild@0.25.1");
      expect(outcome.cards[0]?.message).toContain("esbuild@0.25.0 does not approve esbuild@0.25.1");
    } finally {
      removeTemp(root);
    }
  });

  it("runs an approved script inside the guard and proves ~/.ssh and non-registry hosts stay closed", async () => {
    const root = tempDir();
    try {
      const secretDir = path.join(root, "secret-home", ".ssh");
      const secretFile = path.join(secretDir, "id_rsa");
      const canary = path.join(root, "canary-created.txt");
      const leak = path.join(root, "leak.txt");
      fs.mkdirSync(secretDir, { recursive: true });
      fs.writeFileSync(secretFile, "not-a-real-credential");
      const pkgDir = path.join(root, "native-pkg");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(
        path.join(pkgDir, "postinstall.js"),
        `const fs = require("node:fs");\nfs.writeFileSync(${JSON.stringify(canary)}, "ran");\ntry {\n  const data = fs.readFileSync(${JSON.stringify(secretFile)});\n  fs.writeFileSync(${JSON.stringify(leak)}, data);\n} catch (error) {\n  fs.writeFileSync(${JSON.stringify(path.join(root, "secret-blocked.txt"))}, String(error && error.code));\n}\n`,
      );
      const pkg = metadata({
        name: "native-pkg",
        version: "2.0.0",
        scripts: { postinstall: "node postinstall.js" },
        packageDir: pkgDir,
        tarballUrl: "file:./native-pkg",
      });
      const lockfile = path.join(root, "pnpm-lock.yaml");
      writePnpm(lockfile, "  'native-pkg@2.0.0':\n    resolution: {tarball: file:./native-pkg}\n");
      const runner: InstallerJobRunner = {
        async runCommand(request) {
          if (request.role === "kernel_installer") return { exitCode: 0, stdout: "", stderr: "" };
          return spawnInstallerCommand(request);
        },
      };
      const installer = new KernelPackageInstaller(
        installerOptions(root, [pkg], runner, {
          allowBuilds: ["native-pkg@2.0.0"],
          secretRoots: [secretDir],
        }),
      );
      const outcome = await installer.installLockedDependencies({ lockfilePath: lockfile });
      expect(outcome.status).toBe("installed");
      if (outcome.status !== "installed") return;
      expect(fs.readFileSync(canary, "utf8")).toBe("ran");
      expect(fs.existsSync(leak)).toBe(false);
      expect(fs.readFileSync(path.join(root, "secret-blocked.txt"), "utf8")).toContain("EPERM");
      expect(outcome.receipt.scriptsRan).toBe(true);
      expect(outcome.receipt.installed[0]?.installScriptsRan).toBe(true);
      expect(outcome.receipt.commands.some((command) => command.includes("--ignore-scripts"))).toBe(true);
    } finally {
      removeTemp(root);
    }
  });

  it("fails closed when the red-team probe can read a secret path", async () => {
    const root = tempDir();
    try {
      const pkg = metadata({
        name: "native-pkg",
        version: "2.0.0",
        scripts: { postinstall: "node -e process.exit(0)" },
        tarballUrl: "file:./native-pkg",
      });
      const lockfile = path.join(root, "pnpm-lock.yaml");
      writePnpm(lockfile, "  'native-pkg@2.0.0':\n    resolution: {tarball: file:./native-pkg}\n");
      const runner = recordingRunner(async (request) => {
        if (request.role === "red_team_probe") return { exitCode: 0, stdout: "READ_OK", stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const installer = new KernelPackageInstaller(
        installerOptions(root, [pkg], runner, { allowBuilds: ["native-pkg@2.0.0"] }),
      );
      await expect(installer.installLockedDependencies({ lockfilePath: lockfile })).rejects.toBeInstanceOf(
        SandboxRedTeamError,
      );
    } finally {
      removeTemp(root);
    }
  });

  it("installs from the lockfile with pnpm v10 script blocking, offline store hits, and read-only node_modules", async () => {
    const root = tempDir();
    try {
      const pkg = metadata({ name: "ok-pkg", version: "2.0.0" });
      const store = path.join(root, "pnpm-store");
      fs.mkdirSync(path.join(store, "index"), { recursive: true });
      fs.writeFileSync(path.join(store, "index", integrityFile(pkg.integrity)), "cached");
      const lockfile = path.join(root, "pnpm-lock.yaml");
      writePnpm(lockfile, pnpmPackage("ok-pkg", "2.0.0", pkg.integrity));
      const runner = recordingRunner(async () => {
        const file = path.join(root, "node_modules", "ok-pkg", "index.js");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "module.exports = 1;\n");
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const previousToken = process.env.NPM_TOKEN;
      process.env.NPM_TOKEN = "host-only-token";
      try {
        const installer = new KernelPackageInstaller(installerOptions(root, [pkg], runner, { storeDir: store }));
        const outcome = await installer.installLockedDependencies({ lockfilePath: lockfile });
        expect(outcome.status).toBe("installed");
        if (outcome.status !== "installed") return;
        expect(runner.calls[0]?.args).toEqual(
          expect.arrayContaining([
            "install",
            "--frozen-lockfile",
            "--ignore-scripts",
            "--config.strict-dep-builds=true",
            "--offline",
          ]),
        );
        expect(runner.calls[0]?.env.HTTP_PROXY).toBe("http://127.0.0.1:4019");
        expect(runner.calls[0]?.env.HTTPS_PROXY).toBe("http://127.0.0.1:4019");
        expect(runner.calls[0]?.env.NPM_TOKEN).toBeUndefined();
        expect(outcome.receipt.offline).toBe(true);
        expect(outcome.receipt.networkEgress).toBe(false);
        expect(outcome.receipt.scriptsRan).toBe(false);
        expect(outcome.receipt.installed[0]).toMatchObject({
          name: "ok-pkg",
          version: "2.0.0",
          integrity: pkg.integrity,
          license: "MIT",
          installScriptsRan: false,
        });
        expect(outcome.receipt.nodeModulesReadOnly).toBe(true);
        const installed = path.join(root, "node_modules", "ok-pkg", "index.js");
        expect(fs.statSync(installed).mode & 0o222).toBe(0);
      } finally {
        if (previousToken === undefined) delete process.env.NPM_TOKEN;
        else process.env.NPM_TOKEN = previousToken;
      }
    } finally {
      removeTemp(root);
    }
  });

  it("uses npm ci and yarn immutable installs with scripts ignored", async () => {
    const root = tempDir();
    try {
      const npmLock = path.join(root, "package-lock.json");
      fs.writeFileSync(npmLock, JSON.stringify({ name: "app", lockfileVersion: 3, packages: { "": { name: "app" } } }));
      const npmRunner = recordingRunner();
      const npmInstaller = new KernelPackageInstaller(installerOptions(root, [], npmRunner));
      const npmOutcome = await npmInstaller.installLockedDependencies({ lockfilePath: npmLock });
      expect(npmOutcome.status).toBe("installed");
      expect(npmRunner.calls[0]?.file).toBe("npm");
      expect(npmRunner.calls[0]?.args).toEqual(["ci", "--ignore-scripts"]);
      const yarnLock = path.join(root, "yarn.lock");
      fs.writeFileSync(yarnLock, "# yarn lockfile v1\n");
      const yarnRunner = recordingRunner();
      const yarnInstaller = new KernelPackageInstaller(installerOptions(root, [], yarnRunner));
      const yarnOutcome = await yarnInstaller.installLockedDependencies({ lockfilePath: yarnLock });
      expect(yarnOutcome.status).toBe("installed");
      expect(yarnRunner.calls[0]?.args).toEqual(["install", "--immutable", "--ignore-scripts"]);
    } finally {
      removeTemp(root);
    }
  });

  it("refuses Tier C, worker package-manager installs, and non-registry proxy profiles", async () => {
    const root = tempDir();
    try {
      const lockfile = path.join(root, "pnpm-lock.yaml");
      writePnpm(lockfile, "");
      const runner = recordingRunner();
      const tierC = new KernelPackageInstaller(installerOptions(root, [], runner, { tier: "C" }));
      await expect(tierC.installLockedDependencies({ lockfilePath: lockfile })).rejects.toBeInstanceOf(TierCInstallDenied);
      const worker = new KernelPackageInstaller(installerOptions(root, [], runner, { actor: "worker" }));
      await expect(worker.installLockedDependencies({ lockfilePath: lockfile })).rejects.toBeInstanceOf(
        WorkerDirectInstallDenied,
      );
      const wrongProxy = new KernelPackageInstaller(
        installerOptions(root, [], runner, { proxy: proxy("coding_worker") }),
      );
      await expect(wrongProxy.installLockedDependencies({ lockfilePath: lockfile })).rejects.toBeInstanceOf(
        RegistryProfileError,
      );
      expect(runner.calls).toHaveLength(0);
      expect(isWorkerPackageManagerInstall("pnpm", ["add", "zod"])).toBe(true);
      expect(isWorkerPackageManagerInstall("npm.cmd", ["install"])).toBe(true);
      expect(isWorkerPackageManagerInstall("yarn", ["install", "--immutable"])).toBe(true);
      expect(isWorkerPackageManagerInstall("pip", ["install", "requests"])).toBe(true);
      expect(isWorkerPackageManagerInstall("pnpm", ["test"])).toBe(false);
      expect(isWorkerPackageManagerInstall("git", ["status"])).toBe(false);
    } finally {
      removeTemp(root);
    }
  });

  it("moves the pnpm store onto the worktree volume when hard links would cross drives", async () => {
    const aligned = alignStoreWithWorktree({
      worktreePath: "D:\\wt\\project",
      storeDir: "C:\\pnpm-store",
      volumeOf: (filePath) => (filePath.startsWith("D:") ? "D:" : "C:"),
    });
    expect(aligned.realigned).toBe(true);
    expect(aligned.storeDir).toBe(path.win32.join("D:\\", "EFHarness", "pnpm-store"));
    expect(aligned.warning).toContain("Hard links");
    const root = tempDir();
    try {
      const pkg = metadata({ name: "ok-pkg", version: "2.0.0" });
      const lockfile = path.join(root, "pnpm-lock.yaml");
      writePnpm(lockfile, pnpmPackage("ok-pkg", "2.0.0", pkg.integrity));
      const runner = recordingRunner();
      const installer = new KernelPackageInstaller(
        installerOptions(root, [pkg], runner, {
          storeDir: path.join(root, "STORE"),
          createStoreDirectory: false,
          volumeOf: (filePath) => (filePath.includes(`${path.sep}STORE`) ? "C:" : "D:"),
        }),
      );
      const outcome = await installer.installLockedDependencies({ lockfilePath: lockfile });
      expect(outcome.status).toBe("installed");
      if (outcome.status !== "installed") return;
      expect(outcome.receipt.storeRealigned).toBe(true);
      expect(outcome.receipt.storeDir).toBe(path.win32.join("D:\\", "EFHarness", "pnpm-store"));
      expect(outcome.receipt.storeWarning).toContain("Hard links");
      expect(runner.calls[0]?.args).toContain(outcome.receipt.storeDir);
    } finally {
      removeTemp(root);
    }
  });

  it("rejects a frozen install that rewrites the lockfile", async () => {
    const root = tempDir();
    try {
      const pkg = metadata({ name: "ok-pkg", version: "2.0.0" });
      const lockfile = path.join(root, "pnpm-lock.yaml");
      writePnpm(lockfile, pnpmPackage("ok-pkg", "2.0.0", pkg.integrity));
      const runner = recordingRunner(async () => {
        fs.appendFileSync(lockfile, "\n# mutated\n");
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      const installer = new KernelPackageInstaller(installerOptions(root, [pkg], runner));
      await expect(installer.installLockedDependencies({ lockfilePath: lockfile })).rejects.toBeInstanceOf(
        LockfileMutationError,
      );
    } finally {
      removeTemp(root);
    }
  });

  it("runs installs one at a time on the shared disk lane", async () => {
    const root = tempDir();
    try {
      const lane = new DiskLane();
      fs.mkdirSync(path.join(root, "a"), { recursive: true });
      fs.mkdirSync(path.join(root, "b"), { recursive: true });
      const lockA = path.join(root, "a", "pnpm-lock.yaml");
      const lockB = path.join(root, "b", "pnpm-lock.yaml");
      writePnpm(lockA, "");
      writePnpm(lockB, "");
      const order: string[] = [];
      let releaseFirst: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const runner: InstallerJobRunner = {
        async runCommand() {
          order.push("start");
          if (order.length === 1) await gate;
          order.push("end");
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      };
      const first = new KernelPackageInstaller(
        installerOptions(path.join(root, "a"), [], runner, { diskLane: lane }),
      );
      const second = new KernelPackageInstaller(
        installerOptions(path.join(root, "b"), [], runner, { diskLane: lane }),
      );
      const pending = Promise.all([
        first.installLockedDependencies({ lockfilePath: lockA }),
        second.installLockedDependencies({ lockfilePath: lockB }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(order).toEqual(["start"]);
      releaseFirst();
      await pending;
      expect(order).toEqual(["start", "end", "start", "end"]);
    } finally {
      removeTemp(root);
    }
  });
});
