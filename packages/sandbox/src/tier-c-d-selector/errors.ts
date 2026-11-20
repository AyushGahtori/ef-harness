import type { TaskHold } from "./types.js";

export class WrappedModeForbiddenOnTierCError extends Error {
  readonly code = "wrapped_mode_forbidden_on_tier_c" as const;

  constructor(runtimeId: string) {
    super(
      `Wrapped mode is forbidden on Tier C for ${runtimeId}. Foreign agents on a Tier C-only machine run only in Mode S (stripped), and only for Tier C-eligible tasks.`,
    );
    this.name = "WrappedModeForbiddenOnTierCError";
  }
}

export class TaskHeldError extends Error {
  readonly code = "sandbox_tier_insufficient" as const;

  constructor(readonly hold: TaskHold) {
    super(hold.explanation);
    this.name = "TaskHeldError";
  }
}

export class NetworkPathRejectedError extends Error {
  readonly code = "network_path_acl_unsupported" as const;

  constructor(targetPath: string) {
    super(
      `Tier C cannot use ${targetPath} because write-restricted ACLs are unsupported on UNC and network paths. Use Tier A, Tier D, or move the project to a local disk.`,
    );
    this.name = "NetworkPathRejectedError";
  }
}

export class PathTraversalError extends Error {
  readonly code = "path_traversal_rejected" as const;

  constructor(targetPath: string) {
    super(`Refusing Tier C path that contains a parent-directory segment: ${targetPath}`);
    this.name = "PathTraversalError";
  }
}

export class WorktreeNotEmptyError extends Error {
  readonly code = "worktree_not_empty" as const;

  constructor(targetPath: string) {
    super(
      `Tier C write ACLs can only be granted on an empty attempt directory (${targetPath}) so later files inherit one ACE and no permission walk runs.`,
    );
    this.name = "WorktreeNotEmptyError";
  }
}

export class TierCLaunchError extends Error {
  readonly code = "tier_c_launch_failed" as const;

  constructor(message: string) {
    super(message);
    this.name = "TierCLaunchError";
  }
}

export class TierCHonestyError extends Error {
  readonly code = "tier_c_honesty_violation" as const;

  constructor(message: string) {
    super(message);
    this.name = "TierCHonestyError";
  }
}

export class DockerLeastPrivilegeError extends Error {
  readonly code = "docker_least_privilege" as const;

  constructor(message: string) {
    super(message);
    this.name = "DockerLeastPrivilegeError";
  }
}

export class TierENotInV1Error extends Error {
  readonly code = "tier_e_not_in_v1" as const;

  constructor() {
    super("Tier E remote execution is an interface stub with zero v1 coupling. Local pools do not call it.");
    this.name = "TierENotInV1Error";
  }
}
