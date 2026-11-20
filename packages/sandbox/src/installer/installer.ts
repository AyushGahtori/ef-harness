import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packageInstallCommand, renderCommand } from "./commands.js";
import {
  InstallerError,
  LockfileMutationError,
  RegistryProfileError,
  SandboxRedTeamError,
  TierCInstallDenied,
  WorkerDirectInstallDenied,
} from "./errors.js";
import { RED_TEAM_PROBE, isSecretPath, writeSecretGuard } from "./guard.js";
import { verifyLockfileIntegrity } from "./lockfile.js";
import { reconcileDependencyIntents } from "./reconcile.js";
import {
  alignStoreWithWorktree,
  ensureStoreDirectory,
  markNodeModulesReadOnly,
  sharedDiskLane,
  storeHasIntegrity,
} from "./store.js";
import { DEFAULT_LICENSE_POLICY } from "./spdx.js";
import { checkTyposquat } from "./typosquat.js";
import type {
  AddDependencyRequest,
  ApplyReconciledRequest,
  DependencyAuditReceipt,
  DependencyIntent,
  DependencyReconciliation,
  InstallOutcome,
  InstallScriptApprovalRequired,
  InstallTier,
  InstalledPackageReceipt,
  KernelPackageInstallerOptions,
  LifecycleScripts,
  LockfileIntegrityReport,
  LockfilePackageRecord,
  PackageVersionMetadata,
  SupplyChainVetReport,
} from "./types.js";
import { DEFAULT_MIN_AGE_HOURS, EMPTY_ADVISORIES, resolvePackageVersion, vetDependencyIntent } from "./vet.js";

const INSTALL_LIMITS = { memoryBytes: 1024 * 1024 * 1024, activeProcessLimit: 32 } as const;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const SCRIPT_TIMEOUT_MS = 2 * 60 * 1000;
const ENV_PASSTHROUGH = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PROCESSOR_ARCHITECTURE",
] as const;

function defaultSecretRoots(): readonly string[] {
  const home = os.homedir();
  return [".ssh", ".aws", ".azure", ".gnupg", ".npmrc"].map((leaf) => path.join(home, leaf));
}

function hasLifecycle(scripts: LifecycleScripts): boolean {
  return Boolean(scripts.preinstall || scripts.install || scripts.postinstall);
}

function definedScripts(scripts: LifecycleScripts): LifecycleScripts {
  const copy: { preinstall?: string; install?: string; postinstall?: string } = {};
  if (scripts.preinstall !== undefined) copy.preinstall = scripts.preinstall;
  if (scripts.install !== undefined) copy.install = scripts.install;
  if (scripts.postinstall !== undefined) copy.postinstall = scripts.postinstall;
  return copy;
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function probeTarget(roots: readonly string[]): string {
  const root = roots[0];
  if (!root) {
    throw new InstallerError("sandbox", "Approved install scripts require secret-path roots to probe.");
  }
  const resolved = path.resolve(root);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  return path.join(resolved, "id_rsa");
}

export class KernelPackageInstaller {
  private readonly lane: KernelPackageInstallerOptions["diskLane"];

  constructor(private readonly options: KernelPackageInstallerOptions) {
    this.lane = options.diskLane ?? sharedDiskLane;
  }

  vetDependencyIntent(intent: DependencyIntent): SupplyChainVetReport {
    return vetDependencyIntent(intent, {
      metadata: this.options.metadata,
      advisories: this.options.advisories ?? EMPTY_ADVISORIES,
      now: (this.options.now ?? (() => new Date()))(),
      minAgeHours: this.options.minAgeHours ?? DEFAULT_MIN_AGE_HOURS,
      licensePolicy: this.options.licensePolicy ?? DEFAULT_LICENSE_POLICY,
      ...(this.options.popularPackages ? { popularPackages: this.options.popularPackages } : {}),
    });
  }

  checkTyposquat(packageName: string): ReturnType<typeof checkTyposquat> {
    return checkTyposquat(packageName, this.options.popularPackages);
  }

  verifyLockfileIntegrity(lockfilePath: string): LockfileIntegrityReport {
    return verifyLockfileIntegrity(lockfilePath, { allowedHosts: [...this.options.proxy.allowedHosts] });
  }

  reconcileDependencyIntents(intents: readonly DependencyIntent[]): DependencyReconciliation {
    return reconcileDependencyIntents(intents);
  }

  installLockedDependencies(request: { lockfilePath: string; manifests?: readonly PackageVersionMetadata[] }): Promise<InstallOutcome> {
    const lane = this.lane;
    if (!lane) return Promise.reject(new InstallerError("disk_lane", "The installer disk lane is missing."));
    return lane.run(async () => {
      this.assertKernelInstall();
      return this.installBody(request.lockfilePath, request.manifests ?? []);
    });
  }

  addApprovedDependency(request: AddDependencyRequest): Promise<InstallOutcome> {
    const lane = this.lane;
    if (!lane) return Promise.reject(new InstallerError("disk_lane", "The installer disk lane is missing."));
    return lane.run(async () => {
      this.assertKernelInstall();
      const prepared = this.prepareSingle(request.intent);
      if (prepared.status !== "ready") return prepared.outcome;
      this.writeDependencyUpdate(request.packageJsonPath, request.lockfilePath, [prepared.metadata], [
        { packageName: request.intent.packageName, range: request.intent.range },
      ]);
      return this.installBody(request.lockfilePath, [prepared.metadata]);
    });
  }

  applyReconciledIntents(request: ApplyReconciledRequest): Promise<InstallOutcome> {
    const lane = this.lane;
    if (!lane) return Promise.reject(new InstallerError("disk_lane", "The installer disk lane is missing."));
    return lane.run(async () => {
      this.assertKernelInstall();
      const reconciliation = reconcileDependencyIntents(request.intents);
      if (reconciliation.conflicts.length > 0) {
        return { status: "conflict", reconciliation };
      }
      const manifests: PackageVersionMetadata[] = [];
      for (const update of reconciliation.updates) {
        const prepared = this.prepareSingle({
          taskId: update.taskIds.join(","),
          packageName: update.packageName,
          range: update.range,
          reason: update.reasons.join("; "),
        });
        if (prepared.status !== "ready") return prepared.outcome;
        manifests.push(prepared.metadata);
      }
      const cards = this.approvalCards(manifests);
      if (cards.length > 0) return { status: "approval_required", cards };
      this.writeDependencyUpdate(
        request.packageJsonPath,
        request.lockfilePath,
        manifests,
        reconciliation.updates.map((update) => ({ packageName: update.packageName, range: update.range })),
      );
      return this.installBody(request.lockfilePath, manifests);
    });
  }

  private assertKernelInstall(): void {
    if (this.options.actor === "worker") throw new WorkerDirectInstallDenied();
    if (this.options.tier !== "A" && this.options.tier !== "B" && this.options.tier !== "D") {
      throw new TierCInstallDenied(this.options.tier);
    }
    this.assertProxy();
  }

  private assertProxy(): void {
    const proxy = this.options.proxy;
    if (proxy.profile !== "kernel_installer") {
      throw new RegistryProfileError(
        "Package installs must route exclusively through AllowlistProxyServer profile kernel_installer.",
      );
    }
    let url: URL;
    try {
      url = new URL(proxy.proxyUrl);
    } catch {
      throw new RegistryProfileError("kernel_installer proxy URL is invalid.");
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
      throw new RegistryProfileError("AllowlistProxyServer must bind on loopback.");
    }
    if (proxy.allowedHosts.length === 0) {
      throw new RegistryProfileError("kernel_installer registry allowlist is empty.");
    }
  }

  private prepareSingle(
    intent: DependencyIntent,
  ):
    | { readonly status: "ready"; readonly metadata: PackageVersionMetadata }
    | { readonly status: "blocked"; readonly outcome: InstallOutcome } {
    const report = this.vetDependencyIntent(intent);
    if (report.decision !== "allow" || !report.version) {
      return { status: "blocked", outcome: { status: "vet_blocked", report } };
    }
    const metadata = this.options.metadata.getVersion(intent.packageName, report.version);
    if (!metadata) {
      return { status: "blocked", outcome: { status: "vet_blocked", report } };
    }
    const cards = this.approvalCards([metadata]);
    if (cards.length > 0) return { status: "blocked", outcome: { status: "approval_required", cards } };
    return { status: "ready", metadata };
  }

  private approvalCards(manifests: readonly PackageVersionMetadata[]): InstallScriptApprovalRequired[] {
    const pins = new Set(this.options.allowBuilds ?? []);
    const cards: InstallScriptApprovalRequired[] = [];
    for (const manifest of manifests) {
      if (!hasLifecycle(manifest.scripts)) continue;
      const packageAtVersion = `${manifest.name}@${manifest.version}`;
      if (pins.has(packageAtVersion)) continue;
      cards.push(this.approvalCard(manifest, packageAtVersion));
    }
    return cards;
  }

  private approvalCard(manifest: PackageVersionMetadata, packageAtVersion: string): InstallScriptApprovalRequired {
    const otherPins = (this.options.allowBuilds ?? []).filter((pin) => pin.startsWith(`${manifest.name}@`) && pin !== packageAtVersion);
    const other = otherPins.length > 0 ? ` ${otherPins.join(", ")} does not approve ${packageAtVersion}.` : "";
    return {
      type: "InstallScriptApprovalRequired",
      inboxType: "Approval",
      packageName: manifest.name,
      version: manifest.version,
      packageAtVersion,
      scripts: definedScripts(manifest.scripts),
      scriptPreview: this.scriptPreview(manifest),
      prompt: "Approve this version once",
      actions: ["Approve this version once", "Deny"] as const,
      message: `Lifecycle scripts for ${packageAtVersion} are blocked until the developer approves this exact version. Approving ${packageAtVersion} does not approve any other version.${other}`,
    };
  }

  private scriptPreview(manifest: PackageVersionMetadata): string {
    const roots = this.secretRoots();
    const lines: string[] = [];
    for (const key of ["preinstall", "install", "postinstall"] as const) {
      const value = manifest.scripts[key];
      if (!value) continue;
      lines.push(`${key}: ${value}`);
      const nodeFile = /^node\s+(\S+)$/.exec(value.trim());
      const relative = nodeFile?.[1];
      if (!relative || !manifest.packageDir || /[&|;`$<>]/.test(relative)) continue;
      const filePath = path.resolve(manifest.packageDir, relative);
      if (isSecretPath(filePath, roots) || !fs.existsSync(filePath)) continue;
      lines.push(fs.readFileSync(filePath, "utf8").slice(0, 4000));
    }
    return lines.join("\n");
  }

  private secretRoots(): readonly string[] {
    return this.options.secretRoots ?? defaultSecretRoots();
  }

  private attemptHome(): string {
    return this.options.attemptHome ?? path.join(this.options.worktreePath, ".ef-attempt-home");
  }

  private sandboxEnv(probeSecret: string): Record<string, string> {
    const attemptHome = this.attemptHome();
    const env: Record<string, string> = {};
    for (const key of ENV_PASSTHROUGH) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    env.HOME = attemptHome;
    env.USERPROFILE = attemptHome;
    const root = path.parse(attemptHome).root;
    if (root) {
      env.HOMEDRIVE = root.replace(/[\\/]+$/, "");
      env.HOMEPATH = `${path.sep}${path.relative(root, attemptHome)}`;
    }
    const proxyUrl = this.options.proxy.proxyUrl;
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
    env.NO_PROXY = "127.0.0.1,localhost";
    env.npm_config_ignore_scripts = "true";
    env.npm_config_audit = "false";
    env.npm_config_fund = "false";
    env.npm_config_userconfig = path.join(attemptHome, ".npmrc");
    env.EF_SECRET_ROOTS = this.secretRoots().join("|");
    env.EF_PROBE_SECRET = probeSecret;
    return env;
  }

  private async installBody(
    lockfilePath: string,
    extraManifests: readonly PackageVersionMetadata[],
  ): Promise<InstallOutcome> {
    const tier = this.options.tier as InstallTier;
    const report = this.verifyLockfileIntegrity(lockfilePath);
    const manifests = this.manifestsFor(report.packages, extraManifests);
    const cards = this.approvalCards(manifests);
    if (cards.length > 0) return { status: "approval_required", cards };

    const alignment = alignStoreWithWorktree({
      worktreePath: this.options.worktreePath,
      storeDir: this.options.storeDir,
      ...(this.options.volumeOf ? { volumeOf: this.options.volumeOf } : {}),
    });
    if (this.options.createStoreDirectory !== false) ensureStoreDirectory(alignment.storeDir);
    const offline = report.packages
      .filter((record) => !record.local && record.integrity)
      .every((record) => storeHasIntegrity(alignment.storeDir, record.integrity ?? ""));
    const command = packageInstallCommand({ manager: report.manager, storeDir: alignment.storeDir, offline });
    const attemptHome = this.attemptHome();
    fs.mkdirSync(attemptHome, { recursive: true });
    fs.writeFileSync(
      path.join(attemptHome, ".npmrc"),
      "ignore-scripts=true\nstrict-dep-builds=true\nfund=false\naudit=false\n",
    );
    const roots = this.secretRoots();
    const secretFile = probeTarget(roots);
    const guardPath = writeSecretGuard(attemptHome, roots, this.options.proxy.allowedHosts);
    const env = this.sandboxEnv(secretFile);
    const before = hashFile(lockfilePath);
    const installResult = await this.options.jobRunner.runCommand({
      file: command.file,
      args: command.args,
      cwd: this.options.worktreePath,
      env,
      tier,
      timeoutMs: INSTALL_TIMEOUT_MS,
      role: "kernel_installer",
      limits: INSTALL_LIMITS,
      environmentId: this.options.environmentId ?? "kernel-installer",
    });
    if (hashFile(lockfilePath) !== before) throw new LockfileMutationError(lockfilePath);
    if (installResult.exitCode !== 0) {
      throw new InstallerError(
        "install_failed",
        installResult.stderr || installResult.stdout || "package manager install failed",
      );
    }
    const commands = [renderCommand(command.file, command.args)];
    const ran = new Set<string>();
    for (const manifest of manifests) {
      if (!hasLifecycle(manifest.scripts)) continue;
      await this.runApprovedScripts(manifest, guardPath, env, tier, commands);
      ran.add(`${manifest.name}@${manifest.version}`);
    }
    if (ran.size > 0) {
      const probe = await this.options.jobRunner.runCommand({
        file: process.execPath,
        args: ["--require", guardPath, "-e", RED_TEAM_PROBE],
        cwd: attemptHome,
        env,
        tier,
        timeoutMs: SCRIPT_TIMEOUT_MS,
        role: "red_team_probe",
        limits: INSTALL_LIMITS,
        environmentId: this.options.environmentId ?? "kernel-installer",
      });
      commands.push(renderCommand(process.execPath, ["--require", guardPath, "-e", "red-team-probe"]));
      if (probe.exitCode !== 2) {
        throw new SandboxRedTeamError(
          "Approved install script sandbox can read ~/.ssh or reach a non-registry host.",
        );
      }
    }
    const nodeModules = path.join(this.options.worktreePath, "node_modules");
    const nodeModulesReadOnly = fs.existsSync(nodeModules) && markNodeModulesReadOnly(nodeModules) > 0;
    const receipt: DependencyAuditReceipt = {
      installed: report.packages.map((record) => this.receiptFor(record, manifests, ran)),
      scriptsRan: ran.size > 0,
      offline,
      networkEgress: !offline,
      storeDir: alignment.storeDir,
      storeRealigned: alignment.realigned,
      storeWarning: alignment.warning,
      tier,
      manager: report.manager,
      lockfilePath,
      commands,
      nodeModulesReadOnly,
    };
    return { status: "installed", receipt };
  }

  private manifestsFor(
    records: readonly LockfilePackageRecord[],
    extra: readonly PackageVersionMetadata[],
  ): PackageVersionMetadata[] {
    const manifests: PackageVersionMetadata[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      const metadata = this.options.metadata.getVersion(record.name, record.version);
      if (!metadata) continue;
      const id = `${metadata.name}@${metadata.version}`;
      if (seen.has(id)) continue;
      seen.add(id);
      manifests.push(metadata);
    }
    for (const metadata of extra) {
      const id = `${metadata.name}@${metadata.version}`;
      if (seen.has(id)) continue;
      seen.add(id);
      manifests.push(metadata);
    }
    return manifests;
  }

  private async runApprovedScripts(
    manifest: PackageVersionMetadata,
    guardPath: string,
    env: Readonly<Record<string, string>>,
    tier: InstallTier,
    commands: string[],
  ): Promise<void> {
    for (const key of ["preinstall", "install", "postinstall"] as const) {
      const script = manifest.scripts[key];
      if (!script) continue;
      const invocation = scriptInvocation(script, guardPath);
      const result = await this.options.jobRunner.runCommand({
        file: invocation.file,
        args: invocation.args,
        cwd: manifest.packageDir ?? this.options.worktreePath,
        env,
        tier,
        timeoutMs: SCRIPT_TIMEOUT_MS,
        role: "install_script",
        limits: INSTALL_LIMITS,
        environmentId: this.options.environmentId ?? "kernel-installer",
      });
      commands.push(renderCommand(invocation.file, invocation.args));
      if (result.exitCode !== 0) {
        throw new InstallerError(
          "install_script_failed",
          result.stderr || result.stdout || `${manifest.name}@${manifest.version} ${key} failed`,
        );
      }
    }
  }

  private receiptFor(
    record: LockfilePackageRecord,
    manifests: readonly PackageVersionMetadata[],
    ran: ReadonlySet<string>,
  ): InstalledPackageReceipt {
    const metadata = manifests.find((item) => item.name === record.name && item.version === record.version);
    const packageAtVersion = `${record.name}@${record.version}`;
    return {
      name: record.name,
      version: record.version,
      integrity: record.integrity ?? (record.local ? "local" : ""),
      license: metadata?.license ?? null,
      installScriptsRan: ran.has(packageAtVersion),
    };
  }

  private writeDependencyUpdate(
    packageJsonPath: string,
    lockfilePath: string,
    manifests: readonly PackageVersionMetadata[],
    ranges: readonly { readonly packageName: string; readonly range: string }[],
  ): void {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const dependencies = { ...(parsed.dependencies ?? {}) };
    for (const update of ranges) dependencies[update.packageName] = update.range;
    fs.writeFileSync(packageJsonPath, `${JSON.stringify({ ...parsed, dependencies }, null, 2)}\n`);
    const original = fs.readFileSync(lockfilePath, "utf8");
    const manager = path.basename(lockfilePath).toLowerCase();
    let next = original;
    if (manager === "package-lock.json" || manager === "npm-shrinkwrap.json") {
      next = insertNpmPackages(original, manifests);
    } else if (manager === "yarn.lock") {
      next = `${original.replace(/\s*$/, "\n")}${yarnBlocks(manifests, ranges)}`;
    } else {
      next = insertPnpmPackages(original, manifests);
    }
    fs.writeFileSync(lockfilePath, next);
  }
}

function scriptInvocation(script: string, guardPath: string): { file: string; args: string[] } {
  const nodeFile = /^node\s+(\S+)$/.exec(script.trim());
  const relative = nodeFile?.[1];
  if (relative && !/[&|;`$<>]/.test(relative)) {
    return { file: process.execPath, args: ["--require", guardPath, relative] };
  }
  return { file: process.execPath, args: ["--require", guardPath, "-e", script] };
}

function pnpmBlock(manifest: PackageVersionMetadata): string {
  const tarball = manifest.tarballUrl ? `, tarball: ${manifest.tarballUrl}` : "";
  return `  '${manifest.name}@${manifest.version}':\n    resolution: {integrity: ${manifest.integrity}${tarball}}\n`;
}

function insertPnpmPackages(original: string, manifests: readonly PackageVersionMetadata[]): string {
  const block = manifests.map((manifest) => pnpmBlock(manifest)).join("");
  const lines = original.split(/\r?\n/);
  const index = lines.findIndex((line) => line === "packages:");
  if (index === -1) {
    return `${original.replace(/\s*$/, "\n")}\npackages:\n${block}`;
  }
  lines.splice(index + 1, 0, block.replace(/\n$/, ""));
  return lines.join("\n");
}

function insertNpmPackages(original: string, manifests: readonly PackageVersionMetadata[]): string {
  const parsed = JSON.parse(original) as {
    packages?: Record<string, Record<string, unknown>>;
  };
  const packages = { ...(parsed.packages ?? {}) };
  for (const manifest of manifests) {
    packages[`node_modules/${manifest.name}`] = {
      version: manifest.version,
      resolved: manifest.tarballUrl,
      integrity: manifest.integrity,
      license: manifest.license,
    };
  }
  return `${JSON.stringify({ ...parsed, packages }, null, 2)}\n`;
}

function yarnBlocks(
  manifests: readonly PackageVersionMetadata[],
  ranges: readonly { readonly packageName: string; readonly range: string }[],
): string {
  return manifests
    .map((manifest) => {
      const range = ranges.find((item) => item.packageName === manifest.name)?.range ?? manifest.version;
      const resolved = manifest.tarballUrl ? `\n  resolved "${manifest.tarballUrl}"` : "";
      return `\n"${manifest.name}@${range}":\n  version "${manifest.version}"${resolved}\n  integrity ${manifest.integrity}\n`;
    })
    .join("");
}

export { reconcileDependencyIntents, verifyLockfileIntegrity, checkTyposquat, resolvePackageVersion };
