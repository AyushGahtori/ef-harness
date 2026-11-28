export class UndoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class GitCommandError extends UndoError {
  readonly command: string;
  readonly exitCode: number;

  constructor(command: string, exitCode: number, detail: string) {
    super("git_command", `git ${command} failed (${exitCode}): ${detail.trim()}`);
    this.command = command;
    this.exitCode = exitCode;
  }
}

export class HistoryRewriteError extends UndoError {
  readonly command: string;

  constructor(command: string) {
    super(
      "history_rewrite",
      `Refusing to rewrite published history (${command}). Landed undos are forward commits on harness/integration.`,
    );
    this.command = command;
  }
}

export class UnknownFeatureError extends UndoError {
  constructor(featureId: string) {
    super("unknown_feature", `Feature ${featureId} is not in the undo knowledge graph.`);
  }
}

export class UndoNotConfirmedError extends UndoError {
  constructor() {
    super("not_confirmed", "Undo preview was not confirmed. No files were changed.");
  }
}

export class DestructiveDropError extends UndoError {
  constructor(detail: string) {
    super("destructive_drop", detail);
  }
}

export class RefLeaseHeldError extends UndoError {
  readonly ref: string;
  readonly holder: string;

  constructor(ref: string, holder: string) {
    super("ref_lease_held", `${ref} is leased by ${holder}`);
    this.ref = ref;
    this.holder = holder;
  }
}

export class RegressionFailedError extends UndoError {
  readonly failed: readonly string[];

  constructor(failed: readonly string[]) {
    super("regression_failed", `Combined regression failed: ${failed.join(", ")}`);
    this.failed = failed;
  }
}
