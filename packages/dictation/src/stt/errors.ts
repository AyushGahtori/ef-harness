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

export class WhisperComponentUnavailable extends Error {
  readonly reason: "not_downloaded" | "quarantined" | "hash_mismatch";

  constructor(reason: WhisperComponentUnavailable["reason"], message: string) {
    super(message);
    this.name = "WhisperComponentUnavailable";
    this.reason = reason;
  }
}
