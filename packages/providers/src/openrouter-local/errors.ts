export class OpenRouterLocalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OpenRouterLocalError";
    this.code = code;
  }
}

export class OpenRouterOAuthCancelledError extends OpenRouterLocalError {
  constructor(reason: string) {
    super("cancelled", `OpenRouter sign-in cancelled (${reason})`);
    this.name = "OpenRouterOAuthCancelledError";
  }
}
