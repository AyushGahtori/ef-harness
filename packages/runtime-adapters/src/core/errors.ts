export class SupervisionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SupervisionError";
    this.code = code;
  }
}
