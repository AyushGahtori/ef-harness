import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CodexRuntimeError } from "./errors.js";
import { isInside, isPersonalCodexPath } from "./paths.js";
import type { MxcAlignment } from "./ports.js";
import { assertSafeCodexConfig } from "./process.js";
import type { CodexSkillMount } from "./types.js";

export interface CodexHomePlan {
  readonly codexHome: string;
  readonly configPath: string;
  readonly alignment: MxcAlignment;
  readonly mcpEndpoint: string;
  readonly skills: readonly CodexSkillMount[];
}

export function assertLoopbackProxy(proxy: string): void {
  let url: URL;
  try {
    url = new URL(proxy);
  } catch {
    throw new CodexRuntimeError("proxy_not_loopback", "Codex network must use the loopback proxy");
  }
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]" && host !== "::1") {
    throw new CodexRuntimeError("proxy_not_loopback", "Codex network must use the loopback proxy");
  }
}

export function prepareCodexHome(input: {
  readonly codexHomeRoot: string;
  readonly attemptId: string;
  readonly userHome: string;
  readonly worktreeRoot: string;
  readonly alignment: MxcAlignment;
  readonly mcpEndpoint: string;
  readonly skills: readonly CodexSkillMount[];
}): CodexHomePlan {
  if (input.alignment.sandboxMode !== "workspace-write" || input.alignment.windowsMechanism !== "mxc") {
    throw new CodexRuntimeError("unrestricted_sandbox", "Codex requires Tier A MXC workspace-write");
  }
  if (input.alignment.network !== "disabled-except-loopback-proxy") {
    throw new CodexRuntimeError("unrestricted_sandbox", "Codex network must stay on the loopback proxy");
  }
  assertLoopbackProxy(input.alignment.proxy);
  for (const root of input.alignment.writableRoots) {
    if (!isInside(input.worktreeRoot, root) && path.resolve(root) !== path.resolve(input.worktreeRoot)) {
      throw new CodexRuntimeError("unrestricted_sandbox", "MXC writable roots must stay inside the worktree");
    }
  }
  const codexHome = path.join(input.codexHomeRoot, input.attemptId);
  if (isPersonalCodexPath(codexHome, input.userHome) || isPersonalCodexPath(input.codexHomeRoot, input.userHome)) {
    throw new CodexRuntimeError("personal_codex_home", "refusing to use the developer Codex home");
  }
  const config = renderConfig(input.alignment, input.mcpEndpoint, input.worktreeRoot);
  assertSafeCodexConfig(config);
  mkdirSync(path.join(codexHome, "skills"), { recursive: true });
  writeFileSync(path.join(codexHome, "config.toml"), config, "utf8");
  for (const skill of input.skills) {
    const skillDir = path.join(codexHome, "skills", safeSkillName(skill.name));
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), skill.markdown, "utf8");
  }
  return {
    codexHome,
    configPath: path.join(codexHome, "config.toml"),
    alignment: input.alignment,
    mcpEndpoint: input.mcpEndpoint,
    skills: input.skills,
  };
}

export function renderConfig(alignment: MxcAlignment, mcpEndpoint: string, worktreeRoot: string): string {
  const writable = alignment.writableRoots.map((root) => JSON.stringify(root)).join(", ");
  return [
    "approval_policy = \"on-request\"",
    "sandbox_mode = \"workspace-write\"",
    "",
    "[sandbox_workspace_write]",
    `writable_roots = [${writable}]`,
    "network_access = false",
    "",
    "[windows]",
    "sandbox = \"mxc\"",
    "",
    "[proxy]",
    `url = ${JSON.stringify(alignment.proxy)}`,
    "",
    "[mcp_servers.ef-harness]",
    `url = ${JSON.stringify(mcpEndpoint)}`,
    "bearer_token_env = \"EF_HARNESS_MCP_BEARER\"",
    "enabled = true",
    "",
    `worktree = ${JSON.stringify(worktreeRoot)}`,
    "",
  ].join("\n");
}

function safeSkillName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "");
  if (!cleaned) {
    throw new CodexRuntimeError("bad_skill", "skill name is empty");
  }
  return cleaned;
}
