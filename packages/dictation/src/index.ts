export const packageName = "@ef-harness/dictation" as const;
export const layer = 2 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export * from "./stt/index.js";
export * from "./vocabulary/index.js";

import { warmWhisperBpe } from "./vocabulary/whisper-bpe.js";

warmWhisperBpe();
