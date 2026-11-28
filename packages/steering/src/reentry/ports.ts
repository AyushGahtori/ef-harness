import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from "node:fs";
import path from "node:path";
import { PROJECT_FOLDER_MOVED } from "./messages.js";
import { FIVE_GIBIBYTES, SIXTY_SECONDS_MS } from "./time.js";
import type {
  CliVersionRecord,
  ConnectionObservation,
  DiskObservation,
  HumanStepRecord,
  KnownCliName,
  LockfileObservation,
  MissingRepo,
  ObservedCommit,
  OpenQuestionRecord,
  ProviderConnectionSnapshot,
  RepoInspection,
  StateDbSnapshot,
  ViewHashRecord,
  WorktreeAuditEntry,
  WorktreeExpectation,
} from "./types.js";
import { KNOWN_CLI_NAMES } from "./types.js";

export interface IoJournal {
  readonly commands: string[];
  record(command: string): void;
}

export function createJournal(): IoJournal {
  const commands: string[] = [];
  return {
    commands,
    record(command: string) {
      commands.push(command);
    },
  };
}

const READ_ONLY_GIT = new Set(["status", "rev-parse", "log", "diff-tree", "rev-list", "merge-base"]);

const MUTATING_GIT =
  /^(stash|checkout|clean|reset|switch|restore|commit|add|merge|rebase|push|pull|worktree|branch|init|clone|fetch|gc|rm|mv)$/;

export function assertReadOnlyGitArgs(args: readonly string[]): void {
  const subcommand = args[0] ?? "";
  if (MUTATING_GIT.test(subcommand) || !READ_ONLY_GIT.has(subcommand)) {
    throw new Error(`Refusing git command during cold open: git ${args.join(" ")}`);
  }
}

export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    cwd: string,
  ): { readonly status: number; readonly stdout: string; readonly stderr: string };
}

export function createNodeCommandRunner(journal: IoJournal): CommandRunner {
  return {
    run(command, args, cwd) {
      if (command === "git") assertReadOnlyGitArgs(args);
      const rendered = `${command} ${args.join(" ")}`;
      journal.record(rendered);
      const result = spawnSync(command, [...args], {
        cwd,
        encoding: "utf8",
        windowsHide: true,
        timeout: 1500,
      });
      return {
        status: result.status ?? 1,
        stdout: result.stdout ?? "",
        stderr: result.error ? String(result.error) : (result.stderr ?? ""),
      };
    },
  };
}

export interface MinGitRepoInspectorPort {
  inspect(snapshot: StateDbSnapshot): RepoInspection | MissingRepo;
}

export interface WorktreeSlotPoolPort {
  audit(projectId: string, expectations: readonly WorktreeExpectation[]): readonly WorktreeAuditEntry[];
}

export interface ViewManifestHashScannerPort {
  scan(projectRoot: string): readonly ViewHashRecord[];
}

export interface SharedQuestionArbiterPort {
  listOpen(projectId: string, snapshot: StateDbSnapshot): readonly OpenQuestionRecord[];
}

export interface HumanStepProbeRegistryPort {
  reprobe(step: HumanStepRecord): { readonly status: "pending" | "failed" | "verified"; readonly evidence: string };
}

export interface SingleAppShellPort {
  closeReason(snapshot: StateDbSnapshot): "clean_quit" | "crash" | "parked" | "sleep" | "first_open";
}

export interface ProcessProbePort {
  readonly reliable: boolean;
  isAlive(pid: number): boolean;
  liveGitPids(): readonly number[];
}

export interface DiskHeadroomPort {
  inspect(projectRoot: string): DiskObservation;
}

export interface ConnectionCheckPort {
  observe(snapshot: ProviderConnectionSnapshot, nowIso: string): ConnectionObservation;
}

export interface CliVersionPort {
  current(): readonly CliVersionRecord[];
}

export interface LockfileHashPort {
  hash(projectRoot: string): LockfileObservation;
}

export interface ReconcilePorts {
  readonly git: MinGitRepoInspectorPort;
  readonly worktrees: WorktreeSlotPoolPort;
  readonly views: ViewManifestHashScannerPort;
  readonly questions: SharedQuestionArbiterPort;
  readonly humanSteps: HumanStepProbeRegistryPort;
  readonly shell: SingleAppShellPort;
  readonly processes: ProcessProbePort;
  readonly disk: DiskHeadroomPort;
  readonly connections: ConnectionCheckPort;
  readonly clis: CliVersionPort;
  readonly lockfiles: LockfileHashPort;
  readonly journal: IoJournal;
}

export function decideLockSafety(input: {
  readonly present: boolean;
  readonly ageMs: number | null;
  readonly liveGitPids: readonly number[];
  readonly probeReliable: boolean;
}): { readonly safe: boolean; readonly reason: string } {
  if (!input.present) return { safe: false, reason: "no index lock" };
  if (!input.probeReliable) {
    return { safe: false, reason: "git process probe unavailable — leaving the lock untouched" };
  }
  if (input.liveGitPids.length > 0) {
    return { safe: false, reason: "live git process holds the lock" };
  }
  if (input.ageMs === null || input.ageMs < SIXTY_SECONDS_MS) {
    return { safe: false, reason: "index lock is newer than 60 seconds" };
  }
  return { safe: true, reason: "stale index lock with no live git process" };
}

export function createNodeGitInspector(runner: CommandRunner): MinGitRepoInspectorPort {
  return {
    inspect(snapshot) {
      if (!existsSync(snapshot.projectRoot)) {
        return { missing: true, code: "ENOENT", message: PROJECT_FOLDER_MOVED };
      }
      try {
        const branch = gitOk(runner, snapshot.projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
        const head = gitOk(runner, snapshot.projectRoot, ["rev-parse", "HEAD"]);
        if (!branch || !head) {
          return unreadableRepo(snapshot.projectRoot, "The checkout could not be read. Nothing was changed.");
        }
        const integration = gitOk(runner, snapshot.projectRoot, [
          "rev-parse",
          "--verify",
          "--quiet",
          "harness/integration",
        ]);
        const originMain = gitOk(runner, snapshot.projectRoot, ["rev-parse", "--verify", "--quiet", "origin/main"]);
        const dirty = parsePorcelain(
          gitOk(runner, snapshot.projectRoot, ["status", "--porcelain=v1", "-uall"]) ?? "",
        );
        const commits = readCommitsSince(runner, snapshot.projectRoot, snapshot.recordedHead, originMain);
        const lockPath = path.join(snapshot.projectRoot, ".git", "index.lock");
        let indexLockMtimeMs: number | null = null;
        if (existsSync(lockPath)) indexLockMtimeMs = statSync(lockPath).mtimeMs;
        return {
          missing: false,
          branch: branch.trim(),
          head: head.trim(),
          integrationHead: integration ? integration.trim() : null,
          originMainHead: originMain ? originMain.trim() : null,
          dirtyFiles: dirty,
          commits,
          indexLockPath: indexLockMtimeMs === null ? null : lockPath,
          indexLockMtimeMs,
          readError: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "The checkout could not be read.";
        if (message.startsWith("Refusing git command")) throw error;
        return unreadableRepo(snapshot.projectRoot, "The checkout could not be read. Nothing was changed.");
      }
    },
  };
}

function unreadableRepo(projectRoot: string, message: string): RepoInspection {
  const lockPath = path.join(projectRoot, ".git", "index.lock");
  let indexLockMtimeMs: number | null = null;
  if (existsSync(lockPath)) indexLockMtimeMs = statSync(lockPath).mtimeMs;
  return {
    missing: false,
    branch: "",
    head: "",
    integrationHead: null,
    originMainHead: null,
    dirtyFiles: [],
    commits: [],
    indexLockPath: indexLockMtimeMs === null ? null : lockPath,
    indexLockMtimeMs,
    readError: message,
  };
}

function gitOk(runner: CommandRunner, cwd: string, args: readonly string[]): string | null {
  const result = runner.run("git", args, cwd);
  if (result.status !== 0) return null;
  const stdout = result.stdout.trim();
  return stdout.length > 0 ? stdout : null;
}

function readCommitsSince(
  runner: CommandRunner,
  cwd: string,
  recordedHead: string,
  originMain: string | null,
): readonly ObservedCommit[] {
  if (!recordedHead) return [];
  const listed = gitOk(runner, cwd, ["rev-list", "--reverse", `${recordedHead}..HEAD`]);
  if (!listed) return [];
  const shas = listed.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const commits: ObservedCommit[] = [];
  for (const sha of shas) {
    const subject = gitOk(runner, cwd, ["log", "-1", "--format=%s", sha]) ?? "";
    const names = gitOk(runner, cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha]) ?? "";
    const files = names.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
    let kind: "local" | "upstream" = "local";
    if (originMain) {
      const ancestor = runner.run("git", ["merge-base", "--is-ancestor", sha, "origin/main"], cwd);
      if (ancestor.status === 0) kind = "upstream";
    }
    commits.push({ sha, subject, files, kind });
  }
  return commits;
}

function parsePorcelain(porcelain: string): string[] {
  const files: string[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let file = line.length > 3 ? line.slice(3) : line;
    if (file.includes(" -> ")) file = file.split(" -> ").at(-1) ?? file;
    file = file.replaceAll("\\", "/").replaceAll('"', "");
    if (file) files.push(file);
  }
  return files;
}

export function createFileWorktreePool(runner: CommandRunner): WorktreeSlotPoolPort {
  return {
    audit(_projectId, expectations) {
      return expectations.map((slot) => auditSlot(runner, slot));
    },
  };
}

function auditSlot(runner: CommandRunner, slot: WorktreeExpectation): WorktreeAuditEntry {
  if (!existsSync(slot.path)) {
    return {
      slotId: slot.slotId,
      path: slot.path,
      state: "deleted",
      liveHead: null,
      indexLockPath: null,
      indexLockMtimeMs: null,
    };
  }
  const lockPath = path.join(slot.path, ".git", "index.lock");
  const lockPresent = existsSync(lockPath);
  const liveHead = gitOk(runner, slot.path, ["rev-parse", "HEAD"]);
  let state: WorktreeAuditEntry["state"] = "present";
  if (lockPresent) state = "locked";
  else if (!liveHead || liveHead.trim() !== slot.expectedHead) state = "stale";
  return {
    slotId: slot.slotId,
    path: slot.path,
    state,
    liveHead: liveHead ? liveHead.trim() : null,
    indexLockPath: lockPresent ? lockPath : null,
    indexLockMtimeMs: lockPresent ? statSync(lockPath).mtimeMs : null,
  };
}

export function createFileViewScanner(): ViewManifestHashScannerPort {
  return {
    scan(projectRoot) {
      const dir = path.join(projectRoot, ".harness", "views");
      if (!existsSync(dir)) return [];
      const found: ViewHashRecord[] = [];
      walkMarkdown(dir, dir, found);
      found.sort((left, right) => left.path.localeCompare(right.path));
      return found;
    },
  };
}

function walkMarkdown(root: string, current: string, found: ViewHashRecord[]): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(root, full, found);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const relative = path.relative(root, full).replaceAll("\\", "/");
    const sha256 = createHash("sha256").update(readFileSync(full)).digest("hex");
    found.push({ path: `.harness/views/${relative}`, sha256 });
  }
}

export function createFileLockHasher(): LockfileHashPort {
  return {
    hash(projectRoot) {
      return {
        packageJson: hashFile(path.join(projectRoot, "package.json")),
        pnpmLock: hashFile(path.join(projectRoot, "pnpm-lock.yaml")),
      };
    },
  };
}

function hashFile(file: string): string | null {
  if (!existsSync(file)) return null;
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function createDiskHeadroomPort(): DiskHeadroomPort {
  return {
    inspect(projectRoot) {
      if (!existsSync(projectRoot)) {
        return { ok: false, freeBytes: 0, detail: "Project folder is missing" };
      }
      try {
        const stats = statfsSync(projectRoot, { bigint: false });
        const freeBytes = stats.bavail * stats.bsize;
        const ok = freeBytes >= FIVE_GIBIBYTES;
        return {
          ok,
          freeBytes,
          detail: ok ? "disk headroom ok" : "Low disk headroom — free space is below 5 GB",
        };
      } catch {
        return { ok: true, freeBytes: -1, detail: "disk headroom unreadable" };
      }
    },
  };
}

export function createSnapshotConnectionPort(): ConnectionCheckPort {
  return {
    observe(snapshot, nowIso) {
      const now = Date.parse(nowIso);
      const expiry = snapshot.tokenExpiresAt ? Date.parse(snapshot.tokenExpiresAt) : Number.NaN;
      const tokenExpired = !Number.isNaN(expiry) && expiry <= now;
      const expiresInDays =
        !Number.isNaN(expiry) && expiry > now ? Math.ceil((expiry - now) / (24 * 60 * 60 * 1000)) : null;
      return {
        provider: snapshot.provider,
        usedPercent: snapshot.previousUsedPercent,
        allowanceReset: false,
        fiveHourReset: false,
        weeklyReset: false,
        tokenExpired,
        expiresInDays,
      };
    },
  };
}

export function createEchoCliPort(snapshot: readonly CliVersionRecord[]): CliVersionPort {
  return { current: () => snapshot };
}

export function createHumanStepProbeRegistry(
  checkers: Readonly<
    Record<string, () => { readonly status: "pending" | "failed" | "verified"; readonly evidence: string }>
  >,
): HumanStepProbeRegistryPort {
  return {
    reprobe(step) {
      const checker = checkers[step.probeId];
      if (!checker) return { status: step.status, evidence: "no live probe registered" };
      return checker();
    },
  };
}

export function createNodeProcessProbe(journal: IoJournal): ProcessProbePort {
  let reliable = true;
  let pids: readonly number[] = [];
  try {
    pids = listGitPids(journal);
  } catch {
    reliable = false;
    pids = [];
  }
  return {
    reliable,
    isAlive(pid: number) {
      if (!Number.isInteger(pid) || pid <= 0) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    liveGitPids: () => pids,
  };
}

function listGitPids(journal: IoJournal): readonly number[] {
  if (process.platform === "win32") {
    const result = createNodeCommandRunner(journal).run(
      "tasklist",
      ["/FI", "IMAGENAME eq git.exe", "/FO", "CSV", "/NH"],
      process.cwd(),
    );
    if (result.status !== 0) throw new Error("tasklist failed");
    return parseWindowsTasklist(result.stdout);
  }
  const result = createNodeCommandRunner(journal).run("ps", ["-A", "-o", "pid=,comm="], process.cwd());
  if (result.status !== 0) throw new Error("ps failed");
  const pids: number[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\S+)/.exec(line);
    if (!match) continue;
    const comm = match[2] ?? "";
    if (!comm.includes("git")) continue;
    const pid = Number(match[1]);
    if (Number.isInteger(pid)) pids.push(pid);
  }
  return pids;
}

function parseWindowsTasklist(stdout: string): number[] {
  const pids: number[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.toLowerCase().includes("git.exe")) continue;
    const match = /"git\.exe","(\d+)"/i.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    if (Number.isInteger(pid)) pids.push(pid);
  }
  return pids;
}

export function createReconcilePorts(
  snapshot: StateDbSnapshot,
  overrides: Partial<ReconcilePorts> = {},
): ReconcilePorts {
  const journal = overrides.journal ?? createJournal();
  const runner = createNodeCommandRunner(journal);
  const ports: ReconcilePorts = {
    journal,
    git: overrides.git ?? createNodeGitInspector(runner),
    worktrees: overrides.worktrees ?? createFileWorktreePool(runner),
    views: overrides.views ?? createFileViewScanner(),
    questions: overrides.questions ?? { listOpen: () => snapshot.questions },
    humanSteps:
      overrides.humanSteps ??
      createHumanStepProbeRegistry({}),
    shell: overrides.shell ?? { closeReason: () => "clean_quit" },
    processes: overrides.processes ?? createNodeProcessProbe(journal),
    disk: overrides.disk ?? createDiskHeadroomPort(),
    connections: overrides.connections ?? createSnapshotConnectionPort(),
    clis: overrides.clis ?? createEchoCliPort(snapshot.cliVersions),
    lockfiles: overrides.lockfiles ?? createFileLockHasher(),
  };
  return ports;
}

export function cliVersionMap(records: readonly CliVersionRecord[]): Map<KnownCliName, string> {
  const map = new Map<KnownCliName, string>();
  for (const record of records) map.set(record.name, record.version);
  return map;
}

export { KNOWN_CLI_NAMES };
