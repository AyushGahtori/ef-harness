export class HumanFixError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HumanFixError";
  }
}

export class IllegalTaskTransitionError extends HumanFixError {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super("illegal_task_transition", `cannot transition ${from} → ${to}`);
    this.name = "IllegalTaskTransitionError";
  }
}

export class TaskNotFoundError extends HumanFixError {
  constructor(readonly taskId: string) {
    super("task_not_found", `task ${taskId} not found`);
    this.name = "TaskNotFoundError";
  }
}

export class GitCommandError extends HumanFixError {
  constructor(
    readonly command: string,
    readonly exitCode: number,
    readonly output: string,
  ) {
    super("git_command_failed", `${command} exited ${exitCode}: ${output}`);
    this.name = "GitCommandError";
  }
}

export class ScopeCollisionError extends HumanFixError {
  constructor(
    readonly path: string,
    readonly siblingTaskId: string,
  ) {
    super("scope_collision", `${path} collides with active task ${siblingTaskId}`);
    this.name = "ScopeCollisionError";
  }
}

export class VerificationFailedError extends HumanFixError {
  constructor(readonly failedCheckIds: readonly string[]) {
    super("verification_failed", `failed checks: ${failedCheckIds.join(", ")}`);
    this.name = "VerificationFailedError";
  }
}