export class UncheckpointedWorkError extends Error {
  readonly active: number;
  readonly checkpointed: number;

  constructor(active: number, checkpointed: number) {
    super(`Refusing to install an update while ${String(active - checkpointed)} workers are still uncheckpointed`);
    this.name = "UncheckpointedWorkError";
    this.active = active;
    this.checkpointed = checkpointed;
  }
}

export class BackupNotVerifiedError extends Error {
  readonly snapshotPath: string;

  constructor(snapshotPath: string) {
    super(`Refusing to continue because the state.db backup was not verified (${snapshotPath})`);
    this.name = "BackupNotVerifiedError";
    this.snapshotPath = snapshotPath;
  }
}

export class NewerSchemaVersionError extends Error {
  readonly databaseName: "state.db" | "global.db";

  constructor(message: string, databaseName: "state.db" | "global.db") {
    super(message);
    this.name = "NewerSchemaVersionError";
    this.databaseName = databaseName;
  }
}

export class UpdateNotReadyError extends Error {
  constructor(message = "Update package is not downloaded yet") {
    super(message);
    this.name = "UpdateNotReadyError";
  }
}

export class ForwardOnlyCheckpointError extends Error {
  readonly fromVersion: number;
  readonly targetVersion: number;

  constructor(fromVersion: number, targetVersion: number) {
    super(`Checkpoint schema ${String(fromVersion)} cannot move backward to ${String(targetVersion)}`);
    this.name = "ForwardOnlyCheckpointError";
    this.fromVersion = fromVersion;
    this.targetVersion = targetVersion;
  }
}
