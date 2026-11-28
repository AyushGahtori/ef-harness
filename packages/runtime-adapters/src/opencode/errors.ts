export class OpenCodeAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OpenCodeAdapterError";
    this.code = code;
  }
}
