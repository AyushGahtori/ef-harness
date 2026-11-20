import type { LockfileIntegrityFailure } from "./types.js";

export class InstallerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InstallerError";
    this.code = code;
  }
}

export class TierCInstallDenied extends InstallerError {
  constructor(tier: string) {
    super(
      "tier_c_denied",
      `KernelPackageInstaller refuses tier ${tier}. Dependency installs require Tier A, B, or D and never Tier C.`,
    );
    this.name = "TierCInstallDenied";
  }
}

export class WorkerDirectInstallDenied extends InstallerError {
  constructor() {
    super(
      "worker_direct_install_denied",
      "Workers cannot run pnpm add, npm install, yarn install, or pip install. Call harness.request_dependency(pkg, range, reason) so the integrator can vet and install.",
    );
    this.name = "WorkerDirectInstallDenied";
  }
}

export class LockfileIntegrityError extends InstallerError {
  readonly failures: readonly LockfileIntegrityFailure[];

  constructor(failures: readonly LockfileIntegrityFailure[]) {
    super(
      "lockfile_integrity",
      failures.map((failure) => failure.detail).join("; ") || "lockfile integrity check failed",
    );
    this.name = "LockfileIntegrityError";
    this.failures = failures;
  }
}

export class SandboxRedTeamError extends InstallerError {
  constructor(message: string) {
    super("sandbox_red_team", message);
    this.name = "SandboxRedTeamError";
  }
}

export class RegistryProfileError extends InstallerError {
  constructor(message: string) {
    super("registry_profile", message);
    this.name = "RegistryProfileError";
  }
}

export class LockfileMutationError extends InstallerError {
  constructor(lockfilePath: string) {
    super(
      "lockfile_mutation",
      `Attempt install mutated ${lockfilePath}. Worker syncs are lockfile-only and must pass --frozen-lockfile.`,
    );
    this.name = "LockfileMutationError";
  }
}
