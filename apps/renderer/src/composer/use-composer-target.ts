import type { ComposerTargetStateMachine } from "./composer-target-state-machine.js";
import type { ComposerTargetHookSnapshot } from "./types.js";

export interface ComposerTargetBinding {
  getSnapshot(): ComposerTargetHookSnapshot;
  subscribe(listener: () => void): () => void;
}

export function useComposerTarget(machine: ComposerTargetStateMachine): ComposerTargetBinding {
  return {
    getSnapshot: () => machine.exportTargetSnapshot(),
    subscribe: (listener) => machine.subscribe(listener),
  };
}
