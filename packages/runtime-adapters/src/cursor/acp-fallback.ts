import type { CursorRuntimeDeps } from "./ports.js";
import { SupervisedCursorRuntime } from "./runtime.js";

export class CursorAcpFallbackAdapter extends SupervisedCursorRuntime {
  constructor(deps: CursorRuntimeDeps) {
    super(deps, "acp");
  }
}
