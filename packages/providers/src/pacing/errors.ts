export class PacingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PacingError";
    this.code = code;
  }
}
