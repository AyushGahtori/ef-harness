import type { StaticAuditAstEngine } from "./ports.js";
import { createTask058AstEngine } from "./task-058-ast-engine.js";

/**
 * Default static-audit engine for the gate.
 * This is the Task 058 scanner pipeline (`scanStubBodies`, `scanJsxDeadControls`,
 * markers, swallowed errors, and elision), not the earlier regex stand-in.
 */
export function createLocalStaticAuditAstEngine(): StaticAuditAstEngine {
  return createTask058AstEngine();
}
