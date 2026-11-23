export class ClaudeCodeAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ClaudeCodeAdapterError";
    this.code = code;
  }
}
