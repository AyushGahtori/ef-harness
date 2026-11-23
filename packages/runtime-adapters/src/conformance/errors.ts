export class ConformanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConformanceError";
    this.code = code;
  }
}

export class ConformanceAbortedError extends ConformanceError {
  constructor() {
    super("aborted", "Conformance run was cancelled before it finished");
    this.name = "ConformanceAbortedError";
  }
}
