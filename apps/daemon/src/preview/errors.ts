export class LiveKeyRefusedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LiveKeyRefusedError";
    this.code = code;
  }
}

export class PreviewMigrationRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewMigrationRejectedError";
  }
}

export class PortOutOfRangeError extends Error {
  readonly port: number;

  constructor(port: number) {
    super(`port ${port} is outside ${41_000}-${48_999}`);
    this.name = "PortOutOfRangeError";
    this.port = port;
  }
}

export class PortLeaseConflictError extends Error {
  readonly port: number;

  constructor(port: number) {
    super(`port ${port} is already leased`);
    this.name = "PortLeaseConflictError";
    this.port = port;
  }
}

export class PreviewBootFailedError extends Error {
  readonly banner: string;
  readonly stderrRedacted: string;

  constructor(message: string, banner: string, stderrRedacted: string) {
    super(message);
    this.name = "PreviewBootFailedError";
    this.banner = banner;
    this.stderrRedacted = stderrRedacted;
  }
}
