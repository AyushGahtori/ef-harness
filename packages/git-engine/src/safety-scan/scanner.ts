import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseUnifiedDiff, splitNulPaths } from "./diff-text.js";
import { createNodeIo } from "./fs-io.js";
import { createDefaultGitRunner, resolveGitPath } from "./git-runner.js";
import { IgnoreRules } from "./gitignore.js";
import {
  absentGitleaks,
  cleanGitleaks,
  resolveGitleaksBinary,
  runGitleaksDetect,
  stageFiles,
  writeDiffStage,
} from "./gitleaks.js";
import { isInsideRoot, isFixturePath, relativePosix, basenamePosix, assertRevision } from "./paths.js";
import { buildGitignoreProposal, omittedIgnoreLines, splitRejectedAdditions } from "./proposal.js";
import {
  canonicalJunkName,
  isEnvSecretFileName,
  isKeystoreMagic,
  isPrivateKeyFileName,
  maskWithRedactor,
  scanTextContent,
} from "./secret-rules.js";
import {
  BUILD_DIRECTORY_NAMES,
  DEFAULT_COMMAND_TIMEOUT_MS,
  GitSafetyError,
  JUNK_FILE_NAMES,
  LARGE_FILE_BYTES,
  MAX_WALK_ENTRIES,
  BINARY_SNIFF_BYTES,
} from "./types.js";
import type {
  AppliedGitignoreProposal,
  BlockedSecretFinding,
  DiffSecretScanResult,
  GitRunner,
  GitignoreProposal,
  GitignoreProposalInput,
  GitleaksRunStatus,
  LargeFileFinding,
  SafetyScanIo,
  SafetyScanReport,
  SecretRedactor,
  StackId,
  VaultSecret,
  GitSafetyScannerOptions,
} from "./types.js";

interface ScanSignals {
  readonly stacks: readonly StackId[];
  readonly foundEnv: boolean;
  readonly foundKeys: boolean;
  readonly junkNames: readonly string[];
  readonly buildDirs: readonly string[];
  readonly largeFiles: readonly string[];
  readonly secretPaths: readonly string[];
}

interface Collected {
  blocked: BlockedSecretFinding[];
  large: LargeFileFinding[];
  warnings: string[];
  stacks: Set<StackId>;
  foundEnv: boolean;
  foundKeys: boolean;
  junk: Set<string>;
  buildDirs: Set<string>;
  stage: string[];
  entries: number;
}

const STACK_ORDER: readonly StackId[] = ["node", "python", "rust", "go"];
const FIXTURE_MARKER = ["test-fixture", "-not-secret"].join("");

function canonicalBuildDirectory(name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const entry of BUILD_DIRECTORY_NAMES) {
    if (entry.toLowerCase() === lower) return entry;
  }
  return undefined;
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "Error";
}

function dedupeFindings(findings: readonly BlockedSecretFinding[]): BlockedSecretFinding[] {
  const seen = new Set<string>();
  const result: BlockedSecretFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.file}\0${finding.line}\0${finding.ruleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  result.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.ruleId.localeCompare(right.ruleId),
  );
  return result;
}

function isLockFile(name: string): boolean {
  return (
    name === "package-lock.json" ||
    name === "pnpm-lock.yaml" ||
    name === "yarn.lock" ||
    name === "Cargo.lock" ||
    name === "go.sum" ||
    name.endsWith(".lock")
  );
}

function noteStack(name: string, stacks: Set<StackId>): void {
  if (name === "package.json") stacks.add("node");
  else if (name === "pyproject.toml") stacks.add("python");
  else if (name === "Cargo.toml") stacks.add("rust");
  else if (name === "go.mod") stacks.add("go");
}

async function readRegularFile(file: string): Promise<string> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return "";
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

export class GitSafetyScanner {
  private readonly root: string;
  private readonly git: GitRunner;
  private readonly io: SafetyScanIo;
  private readonly redactor: SecretRedactor | undefined;
  private readonly vaultSecrets: readonly VaultSecret[];
  private readonly gitleaksBinary: string | undefined;
  private readonly gitleaksArgsPrefix: readonly string[];
  private readonly gitleaksTimeoutMs: number;
  private readonly gitleaksEnv: Readonly<Record<string, string>> | undefined;
  private readonly suppressed: readonly string[];
  private readonly rejected = new Set<string>();
  private signals: ScanSignals | undefined;

  constructor(options: GitSafetyScannerOptions) {
    this.root = path.resolve(options.root);
    this.git = options.git ?? createDefaultGitRunner();
    this.io = options.io ?? createNodeIo();
    this.redactor = options.redactor;
    this.vaultSecrets = options.vaultSecrets ?? [];
    this.gitleaksBinary = options.gitleaksBinary;
    this.gitleaksArgsPrefix = options.gitleaksArgsPrefix ?? [];
    this.gitleaksTimeoutMs = options.gitleaksTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.gitleaksEnv = options.gitleaksEnv;
    this.suppressed = options.suppressedGitignoreLines ?? [];
  }

  async scanWorkingTreeForBaseline(): Promise<SafetyScanReport> {
    const rootStat = await this.io.lstat(this.root);
    if (!rootStat.isDirectory()) {
      throw new GitSafetyError("scan root is not a directory");
    }
    const ignore = await this.loadIgnore();
    const collected = await this.walk(ignore);
    const gitleaks = await this.scanStaged(collected);
    const blockedSecrets = dedupeFindings(collected.blocked);
    const largeFiles = [...collected.large].sort((left, right) => left.file.localeCompare(right.file));
    const signals = this.toSignals(collected, blockedSecrets);
    this.signals = signals;
    const existingGitignore = await readRegularFile(path.join(this.root, ".gitignore"));
    const proposal = buildGitignoreProposal({
      existingGitignore,
      suppressedLines: this.suppression(),
      ...signals,
    });
    const warnings = [...new Set(collected.warnings)];
    if (gitleaks.repairSignal) warnings.push("gitleaks-repair");
    return {
      blockedSecrets,
      largeFiles,
      recommendedIgnores: proposal.additions,
      proposedGitignoreDiff: proposal.proposedGitignoreDiff,
      safeToCommit:
        blockedSecrets.length === 0 &&
        largeFiles.length === 0 &&
        signals.junkNames.length === 0 &&
        signals.buildDirs.length === 0,
      secretsNotCommitted: signals.secretPaths,
      gitleaks,
      warnings: warnings.sort(),
    };
  }

  async scanCommitDiffForSecrets(base: string, candidate: string): Promise<DiffSecretScanResult> {
    assertRevision(base);
    assertRevision(candidate);
    const names = await this.diffNames(base, candidate);
    const findings: BlockedSecretFinding[] = [];
    const warnings: string[] = [];
    const contentPaths: string[] = [];
    for (const name of names) {
      const relative = name.replaceAll("\\", "/");
      if (relative.includes("..") || relative.startsWith("/") || path.isAbsolute(name)) {
        warnings.push("skipped-unsafe-path");
        continue;
      }
      const size = await this.blobSize(candidate, relative);
      if (size !== undefined && size > LARGE_FILE_BYTES) {
        findings.push(this.finding(relative, 1, "large-file", "(file exceeds 50 MB)"));
        continue;
      }
      const baseName = basenamePosix(relative);
      if (isEnvSecretFileName(baseName)) {
        findings.push(this.finding(relative, 1, "env-file", "(env file excluded)"));
      }
      if (isPrivateKeyFileName(baseName)) {
        findings.push(this.finding(relative, 1, "private-key-file", "(private key file)"));
      }
      contentPaths.push(relative);
    }
    const diffText = await this.loadDiff(base, candidate, contentPaths);
    const files = parseUnifiedDiff(diffText);
    for (const file of files) {
      if (file.added.length === 0) continue;
      const joined = file.added.map((line) => line.text).join("\n");
      const hits = scanTextContent({
        text: joined,
        relativePath: file.path,
        vaultSecrets: this.vaultSecrets,
        allowPatterns: true,
        allowEntropy: true,
      });
      for (const hit of hits) {
        const original = file.added[hit.line - 1]?.line ?? hit.line;
        findings.push(this.finding(file.path, original, hit.ruleId, hit.preview));
      }
    }
    const gitleaks = await this.gitleaksDiff(files, findings);
    if (gitleaks.repairSignal) warnings.push("gitleaks-repair");
    const deduped = dedupeFindings(findings);
    return {
      rejected: deduped.length > 0,
      severity: deduped.length > 0 ? "interrupt_now" : "clear",
      findings: deduped,
      gitleaks,
      warnings: [...new Set(warnings)].sort(),
    };
  }

  async generateGitignoreProposal(input?: GitignoreProposalInput): Promise<GitignoreProposal> {
    if (!this.signals) await this.scanWorkingTreeForBaseline();
    const signals = this.signals;
    if (!signals) throw new GitSafetyError("safety scan produced no signals");
    const existingGitignore = await readRegularFile(path.join(this.root, ".gitignore"));
    return buildGitignoreProposal({
      existingGitignore,
      stacks: signals.stacks,
      foundEnv: signals.foundEnv,
      foundKeys: signals.foundKeys,
      junkNames: signals.junkNames,
      buildDirs: signals.buildDirs,
      largeFiles: signals.largeFiles,
      secretPaths: signals.secretPaths,
      suppressedLines: [...this.suppression(), ...(input?.suppressedLines ?? [])],
    });
  }

  async applyUserEditedProposal(
    editedText: string,
    proposal: GitignoreProposal,
  ): Promise<AppliedGitignoreProposal> {
    const normalized = editedText.replaceAll("\r\n", "\n");
    const writtenText =
      normalized.length === 0 ? "" : normalized.endsWith("\n") ? normalized : `${normalized}\n`;
    await writeFile(path.join(this.root, ".gitignore"), writtenText, "utf8");
    for (const line of omittedIgnoreLines(proposal.proposedText, writtenText)) {
      this.rejected.add(line);
    }
    const split = splitRejectedAdditions(proposal.additions, writtenText);
    return {
      writtenText,
      rejectedAdditions: split.rejected,
      acceptedAdditions: split.accepted,
    };
  }

  private suppression(): string[] {
    return [...this.suppressed, ...this.rejected];
  }

  private finding(
    file: string,
    line: number,
    ruleId: string,
    preview: string,
  ): BlockedSecretFinding {
    const redactor = this.redactor;
    return {
      file,
      path: file,
      line,
      rule: ruleId,
      ruleId,
      preview: maskWithRedactor(preview, redactor ? (text) => redactor.redact(text) : undefined),
      severity: "interrupt_now",
    };
  }

  private async loadIgnore(): Promise<IgnoreRules> {
    const gitignore = await readRegularFile(path.join(this.root, ".gitignore"));
    const excludePath = await resolveGitPath(this.git, this.root, "info/exclude");
    const exclude = excludePath ? await readRegularFile(excludePath) : "";
    return new IgnoreRules(`${gitignore}\n${exclude}`);
  }

  private emptyCollected(): Collected {
    return {
      blocked: [],
      large: [],
      warnings: [],
      stacks: new Set(),
      foundEnv: false,
      foundKeys: false,
      junk: new Set(),
      buildDirs: new Set(),
      stage: [],
      entries: 0,
    };
  }

  private async walk(ignore: IgnoreRules): Promise<Collected> {
    const collected = this.emptyCollected();
    const pending: { dir: string; statOnly: boolean }[] = [{ dir: this.root, statOnly: false }];
    while (pending.length > 0) {
      const frame = pending.pop();
      if (!frame) break;
      let names: readonly string[];
      try {
        names = await this.io.readdir(frame.dir);
      } catch (error) {
        collected.warnings.push(
          `unreadable:${relativePosix(this.root, frame.dir)}:${errorName(error)}`,
        );
        continue;
      }
      for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
        if (collected.entries >= MAX_WALK_ENTRIES) {
          collected.warnings.push("walk-limit");
          return collected;
        }
        collected.entries += 1;
        if (name === ".git") continue;
        await this.visit(path.join(frame.dir, name), name, frame.statOnly, ignore, collected, pending);
      }
    }
    return collected;
  }

  private async visit(
    absolutePath: string,
    name: string,
    statOnly: boolean,
    ignore: IgnoreRules,
    collected: Collected,
    pending: { dir: string; statOnly: boolean }[],
  ): Promise<void> {
    let stat;
    try {
      stat = await this.io.lstat(absolutePath);
    } catch (error) {
      collected.warnings.push(
        `unreadable:${relativePosix(this.root, absolutePath)}:${errorName(error)}`,
      );
      return;
    }
    const relative = relativePosix(this.root, absolutePath);
    if (stat.isSymbolicLink()) {
      const escapes = await this.symlinkEscapes(absolutePath);
      if (escapes) {
        collected.blocked.push(
          this.finding(relative, 1, "symlink-escape", "(symlink escapes workspace)"),
        );
      }
      if (!ignore.ignores(relative, false)) this.noteSensitiveName(name, relative, collected);
      return;
    }
    if (stat.isDirectory()) {
      if (ignore.ignores(relative, true)) return;
      const buildDir = canonicalBuildDirectory(name);
      if (buildDir) {
        collected.buildDirs.add(buildDir);
        pending.push({ dir: absolutePath, statOnly: true });
        return;
      }
      pending.push({ dir: absolutePath, statOnly });
      return;
    }
    if (!stat.isFile()) return;
    if (ignore.ignores(relative, false)) return;
    if (!statOnly) noteStack(name, collected.stacks);
    const junk = canonicalJunkName(name);
    if (junk) collected.junk.add(junk);
    this.noteSensitiveName(name, relative, collected);
    if (stat.size > LARGE_FILE_BYTES) {
      collected.large.push({ file: relative, sizeBytes: stat.size });
      return;
    }
    if (statOnly) return;
    await this.scanFileContents(absolutePath, relative, name, stat.size, collected);
    collected.stage.push(relative);
  }

  private noteSensitiveName(name: string, relative: string, collected: Collected): void {
    if (isEnvSecretFileName(name)) {
      collected.foundEnv = true;
      collected.blocked.push(this.finding(relative, 1, "env-file", "(env file excluded)"));
    }
    if (isPrivateKeyFileName(name)) {
      collected.foundKeys = true;
      collected.blocked.push(this.finding(relative, 1, "private-key-file", "(private key file)"));
    }
  }

  private async symlinkEscapes(linkPath: string): Promise<boolean> {
    let current = linkPath;
    const seen = new Set<string>();
    for (let hop = 0; hop < 8; hop += 1) {
      const key = path.resolve(current);
      if (seen.has(key)) return true;
      seen.add(key);
      let stat;
      try {
        stat = await this.io.lstat(current);
      } catch {
        return !isInsideRoot(this.root, current);
      }
      if (!stat.isSymbolicLink()) return !isInsideRoot(this.root, current);
      let target: string;
      try {
        target = await this.io.readlink(current);
      } catch {
        return true;
      }
      const next = path.resolve(path.dirname(current), target);
      if (!isInsideRoot(this.root, next)) return true;
      current = next;
    }
    return true;
  }

  private async scanFileContents(
    absolutePath: string,
    relative: string,
    name: string,
    size: number,
    collected: Collected,
  ): Promise<void> {
    let prefix: Buffer;
    try {
      prefix = await this.io.readPrefix(
        absolutePath,
        Math.min(Math.max(size, 1), BINARY_SNIFF_BYTES),
      );
    } catch (error) {
      collected.warnings.push(`unreadable:${relative}:${errorName(error)}`);
      return;
    }
    if (isKeystoreMagic(prefix)) {
      collected.foundKeys = true;
      collected.blocked.push(this.finding(relative, 1, "keystore-magic", "(keystore file)"));
    }
    const binary = prefix.includes(0);
    try {
      const text = binary
        ? prefix.toString("latin1")
        : (size <= prefix.length ? prefix : await this.io.readPrefix(absolutePath, size)).toString(
            "utf8",
          );
      const hits = scanTextContent({
        text,
        relativePath: relative,
        vaultSecrets: this.vaultSecrets,
        allowPatterns: !binary,
        allowEntropy: !binary && !isLockFile(name),
      });
      for (const hit of hits) {
        collected.blocked.push(this.finding(relative, hit.line, hit.ruleId, hit.preview));
      }
    } catch (error) {
      collected.warnings.push(`unreadable:${relative}:${errorName(error)}`);
    }
  }

  private toSignals(
    collected: Collected,
    blocked: readonly BlockedSecretFinding[],
  ): ScanSignals {
    const secretPaths = [...new Set(blocked.map((finding) => finding.file))].sort();
    return {
      stacks: STACK_ORDER.filter((stack) => collected.stacks.has(stack)),
      foundEnv: collected.foundEnv,
      foundKeys: collected.foundKeys,
      junkNames: JUNK_FILE_NAMES.filter((name) => collected.junk.has(name)),
      buildDirs: BUILD_DIRECTORY_NAMES.filter((name) => collected.buildDirs.has(name)),
      largeFiles: collected.large.map((file) => file.file).sort(),
      secretPaths,
    };
  }

  private async scanStaged(collected: Collected): Promise<GitleaksRunStatus> {
    const binary = await resolveGitleaksBinary(this.gitleaksBinary);
    if (!binary) return absentGitleaks();
    if (collected.stage.length === 0) return cleanGitleaks(true, 0);
    const stage = await stageFiles({ root: this.root, relativeFiles: collected.stage });
    try {
      const execution = await runGitleaksDetect({
        command: binary,
        argsPrefix: this.gitleaksArgsPrefix,
        source: stage.directory,
        timeoutMs: this.gitleaksTimeoutMs,
        vaultSecrets: this.vaultSecrets,
        pathMap: stage.pathMap,
        ...(this.gitleaksEnv ? { env: this.gitleaksEnv } : {}),
      });
      for (const hit of execution.hits) {
        if (hit.suppressible && (await this.fixtureSuppresses(hit.file, hit.line))) continue;
        collected.blocked.push(this.finding(hit.file, hit.line, hit.ruleId, hit.preview));
      }
      return execution.status;
    } finally {
      await stage.cleanup();
    }
  }

  private async fixtureSuppresses(relative: string, line: number): Promise<boolean> {
    if (!isFixturePath(relative) || relative.includes("..") || path.isAbsolute(relative)) {
      return false;
    }
    try {
      const prefix = await this.io.readPrefix(path.join(this.root, relative), 64 * 1024);
      const lines = prefix.toString("utf8").split(/\r?\n/);
      const current = lines[line - 1] ?? "";
      const previous = line > 1 ? (lines[line - 2] ?? "") : "";
      if (current.includes(FIXTURE_MARKER) || previous.includes(FIXTURE_MARKER)) return true;
      return lines.slice(0, 15).join("\n").includes(FIXTURE_MARKER);
    } catch {
      return false;
    }
  }

  private async diffNames(base: string, candidate: string): Promise<string[]> {
    const result = await this.git.execGit(
      ["diff", "--name-only", "-z", "--diff-filter=ACMRT", base, candidate],
      { cwd: this.root, timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS },
    );
    if (result.exitCode !== 0) throw new GitSafetyError("git diff failed", result.exitCode);
    return splitNulPaths(result.stdout);
  }

  private async blobSize(revision: string, relative: string): Promise<number | undefined> {
    const result = await this.git.execGit(["cat-file", "-s", `${revision}:${relative}`], {
      cwd: this.root,
      timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) return undefined;
    const size = Number(result.stdout.trim());
    if (!Number.isFinite(size) || size < 0) return undefined;
    return size;
  }

  private async loadDiff(
    base: string,
    candidate: string,
    paths: readonly string[],
  ): Promise<string> {
    if (paths.length === 0) return "";
    const parts: string[] = [];
    for (let index = 0; index < paths.length; index += 40) {
      const batch = paths.slice(index, index + 40);
      const result = await this.git.execGit(
        ["diff", "--unified=0", base, candidate, "--", ...batch],
        { cwd: this.root, timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS },
      );
      if (result.exitCode !== 0) throw new GitSafetyError("git diff failed", result.exitCode);
      parts.push(result.stdout);
    }
    return parts.join("");
  }

  private async gitleaksDiff(
    files: readonly { path: string; added: readonly { line: number; text: string }[] }[],
    findings: BlockedSecretFinding[],
  ): Promise<GitleaksRunStatus> {
    const binary = await resolveGitleaksBinary(this.gitleaksBinary);
    if (!binary) return absentGitleaks();
    const payload = files
      .filter((file) => file.added.length > 0)
      .map((file) => ({
        path: file.path,
        text: file.added.map((line) => line.text).join("\n"),
      }));
    if (payload.length === 0) return cleanGitleaks(true, 0);
    const stage = await writeDiffStage(payload);
    try {
      const execution = await runGitleaksDetect({
        command: binary,
        argsPrefix: this.gitleaksArgsPrefix,
        source: stage.directory,
        timeoutMs: this.gitleaksTimeoutMs,
        vaultSecrets: this.vaultSecrets,
        pathMap: stage.pathMap,
        ...(this.gitleaksEnv ? { env: this.gitleaksEnv } : {}),
      });
      for (const hit of execution.hits) {
        const file = files.find((item) => item.path.replaceAll("\\", "/") === hit.file);
        const original = file?.added[hit.line - 1]?.line ?? hit.line;
        if (hit.suppressible && (await this.fixtureSuppresses(hit.file, original))) continue;
        findings.push(this.finding(hit.file, original, hit.ruleId, hit.preview));
      }
      return execution.status;
    } finally {
      await stage.cleanup();
    }
  }
}
