export const CURSOR_KEY_EXPIRED_ACCOUNT_CARD =
  "Your 90-day Cursor key expired — Re-sign in" as const;

export const CURSOR_LOGIN_ACTION = "Cursor.auth.login" as const;

export const ON_DEMAND_PAUSE_PERCENT = 90;

export const INTERRUPT_BUDGET_MS = 500;

export const MAX_VENTED_SKILLS = 2;

export const ISOLATED_CONFIG_DIRNAME = ".ef-cursor-runtime";

export const ISOLATED_SKILLS_DIRNAME = ".ef-cursor-skills";

export const DEFAULT_LEASED_MCP_TOOLS = ["kb.*", "harness.run", "harness.read_result"] as const;

export { AGENT_RUNTIME_ADAPTER_METHODS } from "../core/interface.js";

export const CONFORMANCE_CHECKS = [
  "preToolUse",
  "beforeShellExecution",
  "local.sandboxOptions",
] as const;
