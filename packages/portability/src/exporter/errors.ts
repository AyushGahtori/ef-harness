export class SecretDetectedInPortabilityExportError extends Error {
  readonly nodeId?: string;
  readonly path: string;
  readonly preview: string;

  constructor(input: { readonly path: string; readonly preview: string; readonly nodeId?: string }) {
    super(`Secret detected in portability export at ${input.path}`);
    this.name = "SecretDetectedInPortabilityExportError";
    this.path = input.path;
    this.preview = input.preview;
    if (input.nodeId !== undefined) this.nodeId = input.nodeId;
  }
}

export class HarnessStatePushBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessStatePushBlockedError";
  }
}