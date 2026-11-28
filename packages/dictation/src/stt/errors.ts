export class DictationError extends Error {
  readonly code:
    | "edit"
    | "audio"
    | "mic"
    | "whisper"
    | "job"
    | "component"
    | "pressure";

  constructor(code: DictationError["code"], message: string) {
    super(message);
    this.name = "DictationError";
    this.code = code;
  }
}
