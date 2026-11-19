import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMemoryAuditLog, createMemoryGovernor, createMemoryJobManager } from "./memory.js";
import { probeMxcAvailability } from "./probe.js";
import { createTierAMxcProvider, TierAMxcProvider } from "./provider.js";
import type { MxcAvailability, SandboxLaunchSpec } from "./types.js";

const PROBE_IDS = ["read_ssh_canary", "write_outside_worktree", "write_git_head", "raw_external_tcp"] as const;

export type LiveProbeId = (typeof PROBE_IDS)[number];

export interface LiveProbeRow {
  readonly testId: LiveProbeId;
  readonly expectedBlocked: true;
  readonly actuallyBlocked: boolean;
  readonly executed: boolean;
  readonly detail: string;
}

export interface LiveRedTeamReport {
  readonly status: "skipped_env_no_mxc" | "not_run" | "executed";
  readonly reason: string;
  readonly claimedOsEnforcement: boolean;
  readonly probes: readonly LiveProbeRow[];
}

export async function runTierALiveRedTeam(options?: {
  readonly availability?: MxcAvailability;
  readonly provider?: TierAMxcProvider;
}): Promise<LiveRedTeamReport> {
  const availability = options?.availability ?? (await probeMxcAvailability());
  if (!availability.available || availability.reason === "os_build_too_old") {
    return report("skipped_env_no_mxc", "skipped_env_no_mxc", false, "skipped_env_no_mxc", false);
  }
  if (options?.provider?.kernelKind === "test_double") {
    return report("not_run", "test_double", false, "test_double_is_not_os_enforcement", false);
  }
  if (!availability.launchable) {
    const reason = availability.launchBlocker ?? "mxc_requires_pinned_helper";
    return report("not_run", reason, false, reason, false);
  }
  return executeLiveProbes(options?.provider);
}

function report(
  status: LiveRedTeamReport["status"],
  reason: string,
  claimedOsEnforcement: boolean,
  detail: string,
  executed: boolean,
): LiveRedTeamReport {
  return {
    status,
    reason,
    claimedOsEnforcement,
    probes: PROBE_IDS.map((testId) => ({
      testId,
      expectedBlocked: true,
      actuallyBlocked: false,
      executed,
      detail,
    })),
  };
}

async function executeLiveProbes(provider: TierAMxcProvider | undefined): Promise<LiveRedTeamReport> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ef-mxc-redteam-"));
  const active =
    provider ??
    createTierAMxcProvider({
      jobManager: createMemoryJobManager(),
      logger: createMemoryAuditLog(),
      governor: createMemoryGovernor(),
    });
  try {
    const layout = await createLayout(root);
    const spec = layout.spec;
    const instance = await active.acquireWarmInstance(spec);
    const rows: LiveProbeRow[] = [];
    rows.push(await readCanary(active, instance, layout.probeScript, layout.canary));
    rows.push(await writeOutside(active, instance, layout.probeScript, layout.outsideFile));
    rows.push(await writeGit(active, instance, layout.probeScript, layout.gitHead));
    rows.push(await rawTcp(active, instance, layout.probeScript));
    await active.disposeInstance(instance);
    const leaked = rows.some((row) => row.executed && !row.actuallyBlocked && !row.detail.startsWith("inconclusive"));
    const allBlocked = rows.every((row) => row.executed && row.actuallyBlocked);
    if (allBlocked) {
      return { status: "executed", reason: "os_mxc", claimedOsEnforcement: true, probes: rows };
    }
    if (leaked) {
      return { status: "executed", reason: "os_boundary_failed", claimedOsEnforcement: false, probes: rows };
    }
    return {
      status: "not_run",
      reason: "inconclusive_not_os_deny",
      claimedOsEnforcement: false,
      probes: rows,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

interface Layout {
  readonly spec: SandboxLaunchSpec;
  readonly canary: string;
  readonly outsideFile: string;
  readonly gitHead: string;
  readonly probeScript: string;
}

async function createLayout(root: string): Promise<Layout> {
  const worktree = path.join(root, "work");
  const tempDir = path.join(root, "temp");
  const buildOutputDir = path.join(root, "build");
  const developerCheckout = path.join(root, "checkout");
  const harnessDataRoot = path.join(root, "harness");
  const userProfile = path.join(root, "profile");
  const localAppData = path.join(root, "local");
  const appData = path.join(root, "roaming");
  const pnpmStore = path.join(root, "store");
  const toolchain = path.join(root, "toolchain");
  const other = path.join(root, "other-work");
  const canary = path.join(userProfile, ".ssh", "canary");
  const outsideFile = path.join(root, "outside", "nope.txt");
  const gitHead = path.join(worktree, ".git", "HEAD");
  const probeScript = path.join(worktree, "probe.cjs");
  await fs.mkdir(path.dirname(canary), { recursive: true });
  await fs.mkdir(path.dirname(outsideFile), { recursive: true });
  await fs.mkdir(path.dirname(gitHead), { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(buildOutputDir, { recursive: true });
  await fs.mkdir(developerCheckout, { recursive: true });
  await fs.mkdir(path.join(harnessDataRoot, "projects"), { recursive: true });
  await fs.mkdir(pnpmStore, { recursive: true });
  await fs.mkdir(toolchain, { recursive: true });
  await fs.mkdir(other, { recursive: true });
  await fs.writeFile(canary, "canary", "utf8");
  await fs.writeFile(gitHead, "ref: refs/heads/main\n", "utf8");
  await fs.writeFile(probeScript, PROBE_SOURCE, "utf8");
  return {
    canary,
    outsideFile,
    gitHead,
    probeScript,
    spec: {
      attemptId: "redteam",
      worktree,
      tempDir,
      buildOutputDir,
      developerCheckout,
      harnessDataRoot,
      userProfile,
      localAppData,
      appData,
      toolchainRoots: [toolchain],
      pnpmStore,
      otherWorktrees: [other],
      mcpPort: 47001,
      proxyPort: 47002,
      mode: "per_command",
    },
  };
}

async function readCanary(
  provider: TierAMxcProvider,
  instance: Awaited<ReturnType<TierAMxcProvider["acquireWarmInstance"]>>,
  probeScript: string,
  canary: string,
): Promise<LiveProbeRow> {
  const result = await provider.executeCommand(instance, {
    command: process.execPath,
    args: [probeScript, "read", canary],
    timeoutMs: 15_000,
  });
  const text = `${result.stdout}\n${result.stderr}`;
  const leaked = result.exitCode === 0 && result.stdout.includes("canary");
  const blocked = osDenied(text, result.denied) && !leaked;
  return row("read_ssh_canary", blocked, leaked ? "canary_read" : blocked ? "EACCES" : "inconclusive_not_os_deny");
}

async function writeOutside(
  provider: TierAMxcProvider,
  instance: Awaited<ReturnType<TierAMxcProvider["acquireWarmInstance"]>>,
  probeScript: string,
  outsideFile: string,
): Promise<LiveProbeRow> {
  const result = await provider.executeCommand(instance, {
    command: process.execPath,
    args: [probeScript, "write", outsideFile],
    timeoutMs: 15_000,
  });
  let leaked = false;
  try {
    leaked = (await fs.readFile(outsideFile, "utf8")).includes("tampered");
  } catch {
    leaked = false;
  }
  const blocked = !leaked && osDenied(`${result.stdout}\n${result.stderr}`, result.denied);
  return row("write_outside_worktree", blocked, leaked ? "outside_write" : blocked ? "EPERM" : "inconclusive_not_os_deny");
}

async function writeGit(
  provider: TierAMxcProvider,
  instance: Awaited<ReturnType<TierAMxcProvider["acquireWarmInstance"]>>,
  probeScript: string,
  gitHead: string,
): Promise<LiveProbeRow> {
  const before = await fs.readFile(gitHead, "utf8");
  const result = await provider.executeCommand(instance, {
    command: process.execPath,
    args: [probeScript, "write", gitHead],
    timeoutMs: 15_000,
  });
  const after = await fs.readFile(gitHead, "utf8");
  const leaked = after !== before;
  const blocked = !leaked && osDenied(`${result.stdout}\n${result.stderr}`, result.denied);
  return row("write_git_head", blocked, leaked ? "git_write" : blocked ? "EPERM" : "inconclusive_not_os_deny");
}

async function rawTcp(
  provider: TierAMxcProvider,
  instance: Awaited<ReturnType<TierAMxcProvider["acquireWarmInstance"]>>,
  probeScript: string,
): Promise<LiveProbeRow> {
  const result = await provider.executeCommand(instance, {
    command: process.execPath,
    args: [probeScript, "tcp"],
    timeoutMs: 15_000,
  });
  const text = `${result.stdout}\n${result.stderr}`;
  if (text.includes("EACCES") || text.includes("EPERM")) {
    return row("raw_external_tcp", true, "EACCES");
  }
  if (text.includes("CONNECTED")) return row("raw_external_tcp", false, "CONNECTED");
  return row("raw_external_tcp", false, "inconclusive_not_os_deny");
}

function osDenied(
  text: string,
  denied: ReadonlyArray<{ readonly errno: string }>,
): boolean {
  return text.includes("EACCES") || text.includes("EPERM") || denied.some((entry) => entry.errno === "EACCES" || entry.errno === "EPERM");
}

function row(testId: LiveProbeId, actuallyBlocked: boolean, detail: string): LiveProbeRow {
  return { testId, expectedBlocked: true, actuallyBlocked, executed: true, detail };
}

const PROBE_SOURCE = [
  "const fs = require('node:fs');",
  "const net = require('node:net');",
  "const op = process.argv[2];",
  "const target = process.argv[3];",
  "if (op === 'read') {",
  "  try { process.stdout.write(fs.readFileSync(target, 'utf8')); process.exit(0); }",
  "  catch (error) { process.stdout.write(String(error && error.code || 'ERROR')); process.exit(1); }",
  "}",
  "if (op === 'write') {",
  "  try { fs.mkdirSync(require('node:path').dirname(target), { recursive: true }); fs.writeFileSync(target, 'tampered'); process.exit(0); }",
  "  catch (error) { process.stdout.write(String(error && error.code || 'ERROR')); process.exit(1); }",
  "}",
  "if (op === 'tcp') {",
  "  const socket = net.connect({ host: '1.1.1.1', port: 443 });",
  "  socket.setTimeout(1500);",
  "  socket.on('connect', () => { process.stdout.write('CONNECTED'); socket.destroy(); process.exit(0); });",
  "  socket.on('timeout', () => { process.stdout.write('TIMEOUT'); socket.destroy(); process.exit(2); });",
  "  socket.on('error', (error) => { process.stdout.write(String(error && error.code || 'ERROR')); process.exit(1); });",
  "}",
  "process.exit(1);",
  "",
].join("\n");
