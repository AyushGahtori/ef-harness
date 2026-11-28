export class ResumeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ResumeError";
    this.code = code;
  }
}
