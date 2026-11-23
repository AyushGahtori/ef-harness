export class BenchmarkIntegrityError extends Error {
  readonly code = "BenchmarkIntegrityError" as const;
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkIntegrityError";
  }
}

export class BenchmarkContaminationError extends Error {
  readonly code = "BenchmarkContaminationError" as const;
  readonly matches: readonly string[];
  constructor(message: string, matches: readonly string[]) {
    super(message);
    this.name = "BenchmarkContaminationError";
    this.matches = matches;
  }
}

export class BenchmarkVersionMismatchError extends Error {
  readonly code = "BenchmarkVersionMismatchError" as const;
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkVersionMismatchError";
  }
}