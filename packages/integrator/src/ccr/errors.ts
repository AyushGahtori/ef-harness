export class CcrError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CcrError";
    this.code = code;
  }
}
