import type { SafetyScanReport } from "./types.js";

export class SnapshotSafetyBlockedError extends Error {
  readonly code = "SNAPSHOT_SAFETY_BLOCKED";
  readonly report: SafetyScanReport;

  constructor(report: SafetyScanReport) {
    super(
      "Snapshot blocked because the uncommitted delta contains secrets or files over 50 MB. No Git object was written.",
    );
    this.name = "SnapshotSafetyBlockedError";
    this.report = report;
  }
}

export class SnapshotGitError extends Error {
  readonly code = "SNAPSHOT_GIT_FAILED";
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(args: readonly string[], exitCode: number | null, stderr: string) {
    super(`git ${args.join(" ")} failed (${exitCode ?? "null"}): ${stderr.trim()}`);
    this.name = "SnapshotGitError";
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class DeveloperWorktreeMutatedError extends Error {
  readonly code = "DEVELOPER_WORKTREE_MUTATED";
  readonly field: string;

  constructor(field: string) {
    super(`Developer worktree field "${field}" changed during snapshotting.`);
    this.name = "DeveloperWorktreeMutatedError";
    this.field = field;
  }
}

export class SnapshotRefRejectedError extends Error {
  readonly code = "SNAPSHOT_REF_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "SnapshotRefRejectedError";
  }
}

export class TempIndexLocationError extends Error {
  readonly code = "TEMP_INDEX_LOCATION";

  constructor(message: string) {
    super(message);
    this.name = "TempIndexLocationError";
  }
}

export class SnapshotConsentRequiredError extends Error {
  readonly code = "SNAPSHOT_CONSENT_REQUIRED";
  readonly subcommand: string;

  constructor(subcommand: string) {
    super(
      `Refusing to run git ${subcommand} against a developer checkout without an explicit consent token.`,
    );
    this.name = "SnapshotConsentRequiredError";
    this.subcommand = subcommand;
  }
}

export class LineEndingOverrideError extends Error {
  readonly code = "GIT_LINE_ENDING_PROTECTED";

  constructor() {
    super(
      "Refusing to override core.autocrlf. Temporary-index adds follow .gitattributes and the repo core.autocrlf.",
    );
    this.name = "LineEndingOverrideError";
  }
}
