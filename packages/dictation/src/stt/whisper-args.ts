import { DictationError } from "./errors.js";

export interface WhisperArgInput {
  readonly modelPath: string;
  readonly carryInitialPrompt?: string;
}

/**
 * whisper.cpp is fed PCM on stdin (`-f -`). No wav path and no URL is ever added.
 * `--carry-initial-prompt` is the Task 158 hook; this task does not build the prompt.
 */
export function buildWhisperCppArgs(input: WhisperArgInput): readonly string[] {
  const args = ["-m", input.modelPath, "-l", "en", "-f", "-", "--no-prints"];
  if (input.carryInitialPrompt !== undefined && input.carryInitialPrompt.length > 0) {
    args.push("--carry-initial-prompt", input.carryInitialPrompt);
  }
  for (const arg of args) {
    if (/\.wav$/i.test(arg) || /^https?:\/\//i.test(arg)) {
      throw new DictationError("audio", "Refusing to persist or upload raw audio");
    }
  }
  return args;
}
