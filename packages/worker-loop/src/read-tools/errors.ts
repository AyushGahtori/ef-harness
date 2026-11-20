export class PathEscapeDeniedError extends Error {
  readonly code = "PATH_ESCAPE_DENIED" as const;

  constructor(readonly requestedPath: string) {
    super(`Path escapes the attempt worktree: ${requestedPath}`);
    this.name = "PathEscapeDeniedError";
  }
}

export class SecretFileDeniedError extends Error {
  readonly code = "SECRET_FILE_DENIED" as const;

  constructor(readonly requestedPath: string) {
    super(`Refusing to read a secret file: ${requestedPath}`);
    this.name = "SecretFileDeniedError";
  }
}

export class FileNotFoundError extends Error {
  readonly code = "FILE_NOT_FOUND" as const;

  constructor(readonly requestedPath: string) {
    super(`File not found: ${requestedPath}`);
    this.name = "FileNotFoundError";
  }
}

export class NotAFileError extends Error {
  readonly code = "NOT_A_FILE" as const;

  constructor(readonly requestedPath: string) {
    super(`Path is not a file: ${requestedPath}`);
    this.name = "NotAFileError";
  }
}

export class InvalidLineRangeError extends Error {
  readonly code = "INVALID_LINE_RANGE" as const;

  constructor(readonly startLine: number, readonly endLine: number) {
    super(`Invalid line range ${startLine}..${endLine}. Use 1-based inclusive bounds with end >= start.`);
    this.name = "InvalidLineRangeError";
  }
}

export class InvalidRegexError extends Error {
  readonly code = "INVALID_REGEX" as const;

  constructor(readonly pattern: string, detail: string) {
    super(
      `Invalid regex "${pattern}": ${detail}. Fix the pattern syntax, or search for a literal string.`,
    );
    this.name = "InvalidRegexError";
  }
}

export class UnsafeRegexError extends Error {
  readonly code = "UNSAFE_REGEX" as const;

  constructor(readonly pattern: string, reason: string) {
    super(
      `Rejected unsafe regex "${pattern}": ${reason}. Use a literal or a pattern without nested quantifiers, backreferences, or quantified alternation so the worker loop cannot freeze.`,
    );
    this.name = "UnsafeRegexError";
  }
}

export class ArtifactNotFoundError extends Error {
  readonly code = "ARTIFACT_NOT_FOUND" as const;

  constructor(readonly artifactId: string) {
    super(`Artifact not found: ${artifactId}. Pass the artifactId returned with the shrunk tool result.`);
    this.name = "ArtifactNotFoundError";
  }
}

export class PackageRootDeniedError extends Error {
  readonly code = "PACKAGE_ROOT_DENIED" as const;

  constructor(readonly packageRoot: string) {
    super(`Package root is not on the read-only allowlist: ${packageRoot}`);
    this.name = "PackageRootDeniedError";
  }
}
