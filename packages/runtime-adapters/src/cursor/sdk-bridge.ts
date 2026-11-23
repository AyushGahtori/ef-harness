import type { CursorRuntimeDeps } from "./ports.js";
import { SupervisedCursorRuntime } from "./runtime.js";

export class CursorLocalSdkBridge extends SupervisedCursorRuntime {
  constructor(deps: CursorRuntimeDeps) {
    super(deps, "sdk");
  }
}
