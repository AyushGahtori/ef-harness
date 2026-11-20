export class PlanPreviewError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PlanPreviewError";
    this.code = code;
  }
}
