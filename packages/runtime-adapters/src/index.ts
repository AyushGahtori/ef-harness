import * as acp from "./acp/index.js";
import * as claudeCode from "./claude-code/index.js";
import * as codex from "./codex/index.js";
import * as conformance from "./conformance/index.js";
import * as copilot from "./copilot/index.js";
import * as core from "./core/index.js";
import * as cursor from "./cursor/index.js";
import * as geminiCli from "./gemini-cli/index.js";
import * as opencode from "./opencode/index.js";
import * as resume from "./resume/index.js";

export const packageName = "@ef-harness/runtime-adapters" as const;
export const layer = 3 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export { acp, claudeCode, codex, conformance, copilot, core, cursor, geminiCli, opencode, resume };

export const runtimeAdapterModules = {
  core,
  acp,
  codex,
  copilot,
  cursor,
  "claude-code": claudeCode,
  "gemini-cli": geminiCli,
  opencode,
  resume,
  conformance,
} as const;
