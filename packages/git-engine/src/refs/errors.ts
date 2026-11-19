export class MissingGitIdentityError extends Error {
  readonly code = "missing_git_identity" as const;
  readonly missing: readonly ("user.name" | "user.email")[];
  readonly prompt =
    "Set Git user.name and user.email in the one-time setup form before harness commits.";

  constructor(missing: readonly ("user.name" | "user.email")[]) {
    super(
      `Missing Git identity (${missing.join(", ")}). Set Git user.name and user.email in the one-time setup form before harness commits.`,
    );
    this.name = "MissingGitIdentityError";
    this.missing = missing;
  }
}

export class NamespaceViolationError extends Error {
  readonly code = "namespace_forbidden" as const;
  readonly ref: string;

  constructor(ref: string, detail?: string) {
    super(
      detail ??
        `Ref ${ref} is outside the harness ref namespace. refs/heads/main and the developer base branch move only through the user-consented landing API.`,
    );
    this.name = "NamespaceViolationError";
    this.ref = ref;
  }
}

export class StaleRefLeaseError extends Error {
  readonly code = "stale_epoch" as const;
  readonly ref: string;
  readonly holder: string;
  readonly epoch: number;
  readonly currentEpoch: number | null;

  constructor(ref: string, holder: string, epoch: number, currentEpoch: number | null) {
    super(
      `Ref lease for ${ref} rejected holder ${holder} at epoch ${epoch}; current epoch is ${currentEpoch ?? "none"}.`,
    );
    this.name = "StaleRefLeaseError";
    this.ref = ref;
    this.holder = holder;
    this.epoch = epoch;
    this.currentEpoch = currentEpoch;
  }
}

export class RefLeaseHeldError extends Error {
  readonly code = "lease_held" as const;
  readonly ref: string;
  readonly holder: string;
  readonly epoch: number;
  readonly expiresAt: number | null;

  constructor(ref: string, holder: string, epoch: number, expiresAt: number | null) {
    super(`Ref ${ref} is leased to ${holder} at epoch ${epoch}.`);
    this.name = "RefLeaseHeldError";
    this.ref = ref;
    this.holder = holder;
    this.epoch = epoch;
    this.expiresAt = expiresAt;
  }
}

export class RefLeaseNotHeldError extends Error {
  readonly code = "lease_not_held" as const;
  readonly ref: string;

  constructor(ref: string, detail?: string) {
    super(detail ?? `No active ref lease is held for ${ref}.`);
    this.name = "RefLeaseNotHeldError";
    this.ref = ref;
  }
}

export class LeaseExpiredError extends Error {
  readonly code = "lease_expired" as const;
  readonly ref: string;
  readonly holder: string;
  readonly epoch: number;
  readonly expiresAt: number;

  constructor(ref: string, holder: string, epoch: number, expiresAt: number) {
    super(`Ref lease for ${ref} held by ${holder} at epoch ${epoch} expired at ${expiresAt}.`);
    this.name = "LeaseExpiredError";
    this.ref = ref;
    this.holder = holder;
    this.epoch = epoch;
    this.expiresAt = expiresAt;
  }
}

export class ProtectedBranchError extends Error {
  readonly code = "protected_wip" as const;
  readonly ref: string;

  constructor(ref: string) {
    super(`Refusing to delete human-exported branch ${ref}. wip/* branches are never force-deleted.`);
    this.name = "ProtectedBranchError";
    this.ref = ref;
  }
}

export class GitCommandError extends Error {
  readonly code = "git_command_failed" as const;
  readonly command: string;
  readonly exitCode: number;
  readonly stderr: string;

  constructor(command: string, exitCode: number, stderr: string) {
    super(`git ${command} failed (${exitCode}): ${stderr.trim()}`);
    this.name = "GitCommandError";
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class InvalidRefLeaseArgumentError extends Error {
  readonly code = "invalid_argument" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidRefLeaseArgumentError";
  }
}
