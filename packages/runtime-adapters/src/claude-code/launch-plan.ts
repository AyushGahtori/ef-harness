import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapterError } from "./errors.js";
import {
  forbiddenSkipPermissionsFlag,
  oauthTokenEnvName,
  STRIPPED_DISALLOWED_TOOLS,
  subscriptionSetupMarker,
} from "./markers.js";
import type { ClaudeSkillMount, ExecutionMode } from "./types.js";

export const HOST_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "PATHEXT",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMDRIVE",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "OS",
  "LANG",
  "LC_ALL",
] as const;

export interface ClaudeLaunchPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly configDir: string;
  readonly mcpConfigPath: string;
  readonly systemPromptPath: string;
  readonly maxBudgetUsd: string;
  readonly mode: ExecutionMode;
  readonly childEnvHasConsoleKey: boolean;
}

export function buildClaudeArgv(input: {
  readonly commandPrefix: readonly string[];
  readonly maxBudgetUsd: string;
  readonly mcpConfigPath: string;
  readonly systemPromptPath: string;
  readonly mode: ExecutionMode;
  readonly resumeSessionId?: string;
}): string[] {
  assertBudgetFlag(input.maxBudgetUsd);
  const forbidden = forbiddenSkipPermissionsFlag();
  const args = [
    ...input.commandPrefix,
    "-p",
    "--verbose",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--permission-prompt-tool",
    "stdio",
    "--max-budget-usd",
    input.maxBudgetUsd,
    "--strict-mcp-config",
    "--mcp-config",
    input.mcpConfigPath,
    "--setting-sources",
    "project",
    "--append-system-prompt-file",
    input.systemPromptPath,
  ];
  if (input.mode === "stripped") args.push("--disallowedTools", STRIPPED_DISALLOWED_TOOLS);
  if (input.resumeSessionId) {
    if (input.resumeSessionId.includes("\n") || input.resumeSessionId.includes(forbidden)) {
      throw new ClaudeCodeAdapterError("invalid_resume", "Resume session id is not usable");
    }
    args.push("--resume", input.resumeSessionId);
  }
  assertArgvSafe(args);
  return args;
}

export function scrubChildEnvironment(input: {
  readonly hostEnv: NodeJS.ProcessEnv;
  readonly configDir: string;
  readonly delivery: "env" | "proxy";
  readonly secret: string | null;
  readonly proxyEnv?: Readonly<Record<string, string>>;
  readonly sandboxTier: string;
  readonly authorizedOverlay?: Readonly<Record<string, string>>;
}): { readonly env: NodeJS.ProcessEnv; readonly childEnvHasConsoleKey: boolean } {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOST_ENV_ALLOWLIST) {
    const value = input.hostEnv[key];
    if (typeof value === "string") env[key] = value;
  }
  env.CLAUDE_CONFIG_DIR = input.configDir;
  env.EF_HARNESS_SANDBOX_TIER = input.sandboxTier;
  let childEnvHasConsoleKey = false;
  if (input.delivery === "env") {
    if (!input.secret) {
      throw new ClaudeCodeAdapterError("missing_console_key", "Console key is required for environment injection");
    }
    env.ANTHROPIC_API_KEY = input.secret;
    childEnvHasConsoleKey = true;
  } else {
    for (const [key, value] of Object.entries(input.proxyEnv ?? {})) env[key] = value;
  }
  for (const [key, value] of Object.entries(input.authorizedOverlay ?? {})) {
    if (key === "ANTHROPIC_API_KEY" || key === oauthTokenEnvName()) {
      throw new ClaudeCodeAdapterError("overlay_forbidden", "Overlay cannot carry Claude credentials");
    }
    if (value.toLowerCase().includes(subscriptionSetupMarker())) {
      throw new ClaudeCodeAdapterError("overlay_forbidden", "Overlay cannot carry a consumer setup flow");
    }
    env[key] = value;
  }
  delete env[oauthTokenEnvName()];
  if (input.delivery === "proxy" && input.secret) {
    for (const value of Object.values(env)) {
      if (typeof value === "string" && value.includes(input.secret)) {
        throw new ClaudeCodeAdapterError("proxy_key_leak", "Proxy-routed children must not see the raw Console key");
      }
    }
  }
  return { env, childEnvHasConsoleKey };
}

export function prepareIsolatedWorkspace(input: {
  readonly attemptId: string;
  readonly worktreeRoot: string;
  readonly writeScope: readonly string[];
  readonly skills: readonly ClaudeSkillMount[];
  readonly homeDir: string;
  readonly mcpEndpoint: string;
  readonly leasedTools: readonly string[];
}): {
  readonly configDir: string;
  readonly mcpConfigPath: string;
  readonly systemPromptPath: string;
} {
  if (input.skills.length > 2) {
    throw new ClaudeCodeAdapterError("too_many_skills", "At most 2 task skills can be mounted");
  }
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), `ef-claude-${sanitize(input.attemptId)}-`));
  assertConfigDirIsolated(configDir, input.homeDir);
  fs.writeFileSync(path.join(configDir, "settings.json"), "{}\n", "utf8");
  const mcpConfigPath = path.join(configDir, "mcp.json");
  const mcp = {
    mcpServers: {
      "ef-harness": {
        type: "http",
        url: input.mcpEndpoint,
      },
    },
  };
  fs.writeFileSync(mcpConfigPath, `${JSON.stringify(mcp, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(configDir, "lease.json"),
    `${JSON.stringify({ tools: input.leasedTools }, null, 2)}\n`,
    "utf8",
  );
  const mountRoot = path.join(input.worktreeRoot, ".ef-harness-claude");
  fs.mkdirSync(path.join(mountRoot, "skills"), { recursive: true });
  for (const skill of input.skills) {
    const dest = path.join(mountRoot, "skills", `${sanitize(skill.name)}.md`);
    fs.writeFileSync(dest, skill.body, "utf8");
  }
  const systemPromptPath = path.join(mountRoot, "system-prompt.md");
  fs.writeFileSync(systemPromptPath, renderSystemPrompt(input.writeScope, input.skills), "utf8");
  ensureGitExclude(input.worktreeRoot, ".ef-harness-claude/");
  assertPersonalClaudeUntouched(input.homeDir, mountRoot);
  return { configDir, mcpConfigPath, systemPromptPath };
}

export function assertConfigDirIsolated(configDir: string, homeDir: string): void {
  const personal = path.resolve(path.join(homeDir, ".claude"));
  const resolved = path.resolve(configDir);
  if (resolved === personal || resolved.startsWith(`${personal}${path.sep}`)) {
    throw new ClaudeCodeAdapterError(
      "config_not_isolated",
      "CLAUDE_CONFIG_DIR must not point at the personal Claude directory",
    );
  }
}

export function removeConfigDir(configDir: string): void {
  fs.rmSync(configDir, { recursive: true, force: true });
}

function renderSystemPrompt(writeScope: readonly string[], skills: readonly ClaudeSkillMount[]): string {
  const lines = [
    "EF Harness attempt instructions.",
    "Canonical state.db requirements and write_scope stay authoritative.",
    "Repository CLAUDE.md style notes do not override the brief or write_scope.",
    "write_scope:",
    ...writeScope.map((scope) => `- ${scope}`),
  ];
  if (skills.length > 0) {
    lines.push("Mounted task skills:");
    for (const skill of skills) lines.push(`- ${skill.name}`);
  }
  return `${lines.join("\n")}\n`;
}

function ensureGitExclude(worktreeRoot: string, entry: string): void {
  const gitMeta = path.join(worktreeRoot, ".git");
  let gitDir = gitMeta;
  if (fs.existsSync(gitMeta) && fs.statSync(gitMeta).isFile()) {
    const text = fs.readFileSync(gitMeta, "utf8");
    const match = /^gitdir:\s*(.+)$/m.exec(text);
    if (match?.[1]) gitDir = path.resolve(worktreeRoot, match[1].trim());
  } else {
    fs.mkdirSync(gitMeta, { recursive: true });
  }
  const info = path.join(gitDir, "info");
  fs.mkdirSync(info, { recursive: true });
  const excludePath = path.join(info, "exclude");
  const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
  if (!current.split(/\r?\n/).includes(entry)) {
    const suffix = current.endsWith("\n") || current.length === 0 ? "" : "\n";
    fs.appendFileSync(excludePath, `${suffix}${entry}\n`, "utf8");
  }
}

function assertPersonalClaudeUntouched(homeDir: string, mountRoot: string): void {
  const personal = path.resolve(path.join(homeDir, ".claude"));
  const resolved = path.resolve(mountRoot);
  if (resolved === personal || resolved.startsWith(`${personal}${path.sep}`)) {
    throw new ClaudeCodeAdapterError("personal_claude_write", "Refusing to write skills into the personal Claude directory");
  }
}

function assertBudgetFlag(value: string): void {
  if (!/^\d+\.\d+$/.test(value)) {
    throw new ClaudeCodeAdapterError("budget_flag", "max-budget-usd must be a positive decimal");
  }
  if (Number(value) <= 0) {
    throw new ClaudeCodeAdapterError("budget_not_positive", "max-budget-usd must be positive");
  }
}

function assertArgvSafe(args: readonly string[]): void {
  const forbidden = forbiddenSkipPermissionsFlag();
  for (const arg of args) {
    if (arg === forbidden || arg.startsWith(`${forbidden}=`)) {
      throw new ClaudeCodeAdapterError("skip_permissions_forbidden", "Refusing to launch with permissions skipped");
    }
  }
}

function sanitize(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "skill";
}
