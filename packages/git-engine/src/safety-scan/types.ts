/**
 * Ports and report types for the first-commit and candidate-diff safety scanner.
 *
 * `GitRunner` matches the Task 035 `execGit` result shape so a real runner can be
 * injected. `SecretRedactor` matches the Task 011 redactor used to mask previews.
 * Vault values are supplied separately because the redactor must not be asked to
 * echo them back.
 */

export const LARGE_FILE_BYTES = 50 * 1024 * 1024;
export const TEXT_SCAN_LIMIT_BYTES = 50 * 1024 * 1024;
export const BINARY_SNIFF_BYTES = 8 * 1024;
export const MIN_VAULT_SECRET_LENGTH = 8;
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const MAX_WALK_ENTRIES = 200_000;

export class GitSafetyError extends Error {
  readonly exitCode: number | null;

  constructor(message: string, exitCode: number | null = null) {
    super(message);
    this.name = "GitSafetyError";
    this.exitCode = exitCode;
  }
}

export interface GitCommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface GitExecOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly userExplicitConsentToken?: string;
}

export interface GitRunner {
  execGit(args: readonly string[], options: GitExecOptions): Promise<GitCommandResult>;
}

export interface SecretRedactor {
  redact(text: string): string;
}

export interface VaultSecret {
  readonly label: string;
  readonly value: string;
}

export interface BlockedSecretFinding {
  readonly file: string;
  readonly path: string;
  readonly line: number;
  readonly rule: string;
  readonly ruleId: string;
  readonly preview: string;
  readonly severity: "interrupt_now";
}

export interface LargeFileFinding {
  readonly file: string;
  readonly sizeBytes: number;
}

export type GitleaksOutcome = "absent" | "clean" | "findings" | "crashed";

export interface GitleaksRunStatus {
  readonly available: boolean;
  readonly exitCode: number | null;
  readonly outcome: GitleaksOutcome;
  readonly repairSignal: boolean;
  readonly timedOut: boolean;
}

export interface SafetyScanReport {
  readonly blockedSecrets: readonly BlockedSecretFinding[];
  readonly largeFiles: readonly LargeFileFinding[];
  readonly recommendedIgnores: readonly string[];
  readonly proposedGitignoreDiff: string;
  readonly safeToCommit: boolean;
  readonly secretsNotCommitted: readonly string[];
  readonly gitleaks: GitleaksRunStatus;
  readonly warnings: readonly string[];
}

export interface DiffSecretScanResult {
  readonly rejected: boolean;
  readonly severity: "interrupt_now" | "clear";
  readonly findings: readonly BlockedSecretFinding[];
  readonly gitleaks: GitleaksRunStatus;
  readonly warnings: readonly string[];
}

export type StackId = "node" | "python" | "rust" | "go";

export interface GitignoreProposal {
  readonly stack: readonly StackId[];
  readonly existingText: string;
  readonly additions: readonly string[];
  readonly proposedText: string;
  readonly proposedGitignoreDiff: string;
  readonly secretsNotCommitted: readonly string[];
  readonly reviewBanner: "these look like secrets and will not be committed";
}

export interface AppliedGitignoreProposal {
  readonly writtenText: string;
  readonly rejectedAdditions: readonly string[];
  readonly acceptedAdditions: readonly string[];
}

export interface EnsureExcludeResult {
  readonly excludePath: string;
  readonly added: readonly string[];
  readonly alreadyPresent: readonly string[];
}

export interface GitignoreProposalInput {
  readonly report?: SafetyScanReport;
  readonly suppressedLines?: readonly string[];
}

export interface StatsLike {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
}

export interface SafetyScanIo {
  lstat(absolutePath: string): Promise<StatsLike>;
  readlink(absolutePath: string): Promise<string>;
  readdir(absolutePath: string): Promise<readonly string[]>;
  readPrefix(absolutePath: string, maxBytes: number): Promise<Buffer>;
}

export interface GitSafetyScannerOptions {
  readonly root: string;
  readonly git?: GitRunner;
  readonly redactor?: SecretRedactor;
  readonly vaultSecrets?: readonly VaultSecret[];
  readonly gitleaksBinary?: string;
  readonly gitleaksArgsPrefix?: readonly string[];
  readonly gitleaksTimeoutMs?: number;
  readonly gitleaksEnv?: Readonly<Record<string, string>>;
  readonly suppressedGitignoreLines?: readonly string[];
  readonly io?: SafetyScanIo;
}

export const REVIEW_BANNER = "these look like secrets and will not be committed" as const;

export const HARNESS_EXCLUDE_ENTRIES = [
  ".harness/views/",
  ".harness/tmp/",
  ".ef-skills/",
  ".harness/skills/",
] as const;

export const BUILD_DIRECTORY_NAMES: readonly string[] = [
  "node_modules",
  ".venv",
  "vendor",
  "target",
  "dist",
  "build",
  ".next",
];

export const JUNK_FILE_NAMES: readonly string[] = [".DS_Store", "Thumbs.db", "desktop.ini"];
