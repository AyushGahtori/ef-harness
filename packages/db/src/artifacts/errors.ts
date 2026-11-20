export class InvalidLineRangeError extends Error {
  readonly code = "INVALID_LINE_RANGE" as const;
  readonly startLine: number;
  readonly endLine: number;

  constructor(startLine: number, endLine: number) {
    super(
      `Invalid log line range ${String(startLine)}..${String(endLine)}. Bounds must be positive integers with endLine >= startLine.`,
    );
    this.name = "InvalidLineRangeError";
    this.startLine = startLine;
    this.endLine = endLine;
  }
}

export class InvalidLogQueryError extends Error {
  readonly code = "INVALID_LOG_QUERY" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidLogQueryError";
  }
}

export class UnsafeLogPatternError extends Error {
  readonly code = "UNSAFE_LOG_PATTERN" as const;
  readonly pattern: string;

  constructor(pattern: string, message: string) {
    super(message);
    this.name = "UnsafeLogPatternError";
    this.pattern = pattern;
  }
}

export class LogLineTooLargeError extends Error {
  readonly code = "LOG_LINE_TOO_LARGE" as const;

  constructor(bytes: number) {
    super(`A log line exceeded the ${String(bytes)} byte assembly cap while crossing seekable frames.`);
    this.name = "LogLineTooLargeError";
  }
}

export class AttemptNotFoundError extends Error {
  readonly code = "ATTEMPT_NOT_FOUND" as const;
  readonly attemptId: string;

  constructor(attemptId: string) {
    super(`Attempt ${attemptId} does not exist.`);
    this.name = "AttemptNotFoundError";
    this.attemptId = attemptId;
  }
}

export class AttemptNotArchivableError extends Error {
  readonly code = "ATTEMPT_NOT_ARCHIVABLE" as const;
  readonly attemptId: string;
  readonly attemptState: string;

  constructor(attemptId: string, attemptState: string) {
    super(
      `Attempt ${attemptId} is ${attemptState} and cannot be archived. running, submitted, and parked turn_log rows stay in place for crash and resume recovery.`,
    );
    this.name = "AttemptNotArchivableError";
    this.attemptId = attemptId;
    this.attemptState = attemptState;
  }
}

export class ArtifactNotFoundError extends Error {
  readonly code = "ARTIFACT_NOT_FOUND" as const;
  readonly artifactId: string;

  constructor(artifactId: string) {
    super(`Artifact ${artifactId} does not exist.`);
    this.name = "ArtifactNotFoundError";
    this.artifactId = artifactId;
  }
}

export class ArtifactNotTextError extends Error {
  readonly code = "ARTIFACT_NOT_TEXT" as const;
  readonly artifactId: string;

  constructor(artifactId: string) {
    super(`Artifact ${artifactId} is not UTF-8 text and cannot be read as a log.`);
    this.name = "ArtifactNotTextError";
    this.artifactId = artifactId;
  }
}

export class AssetRemovalError extends Error {
  readonly code = "ASSET_REMOVAL_REJECTED" as const;
  readonly artifactId: string;

  constructor(artifactId: string, message: string) {
    super(message);
    this.name = "AssetRemovalError";
    this.artifactId = artifactId;
  }
}

export class FrameDecodeError extends Error {
  readonly code = "FRAME_DECODE_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "FrameDecodeError";
  }
}
