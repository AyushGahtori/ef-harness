import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OpenCodeAdapterError } from "./errors.js";
import { evaluatePermission } from "./permission-rules.js";
import { assertLoopbackUrl, providerEnv } from "./provider-route.js";
import type { ExecutionMode, LeasedMcpAttachment, ProviderConnection } from "./types.js";

export interface OpenCodeTools {
  readonly bash: false;
  readonly webfetch: false;
  readonly websearch: false;
  readonly edit?: false;
  readonly write?: false;
}

export interface OpenCodeMcpServer {
  readonly type: "remote";
  readonly url: string;
  readonly enabled: true;
  readonly headers: { readonly Authorization: string };
}

export interface OpenCodePermissionBlock {
  readonly bash: "deny";
  readonly shell: "deny";
  readonly webfetch: "deny";
  readonly websearch: "deny";
  readonly external_directory: "deny";
  readonly doom_loop: "deny";
  readonly edit: "ask" | "deny";
  readonly write: "ask" | "deny";
}

export interface OpenCodeConfigDocument {
  readonly $schema: "https://opencode.ai/config.json";
  readonly compaction: { readonly auto: false };
  readonly tools: OpenCodeTools;
  readonly permission: OpenCodePermissionBlock;
  readonly mcp: { readonly "ef-harness": OpenCodeMcpServer };
  readonly model: string;
  readonly provider: Readonly<Record<string, { readonly options: { readonly baseURL: string } }>>;
}

export interface GeneratedOpenCodeConfig {
  readonly configDir: string;
  readonly configPath: string;
  readonly document: OpenCodeConfigDocument;
  readonly env: Record<string, string>;
  readonly providerEnv: Record<string, string>;
}

export interface GenerateConfigInput {
  readonly configDir: string;
  readonly worktreePath: string;
  readonly mode: ExecutionMode;
  readonly connection: ProviderConnection;
  readonly mcp: LeasedMcpAttachment;
  readonly userConfig?: unknown;
  readonly repoConfig?: unknown;
  readonly preservePaths?: readonly string[];
}

const PERSONAL_CONFIG_TAIL = path.join(".config", "opencode");

export function resolveEffectiveOpenCodeConfig(input: {
  readonly ephemeral: OpenCodeConfigDocument;
  readonly repoConfig: unknown;
  readonly userConfig: unknown;
}): OpenCodeConfigDocument {
  void input.repoConfig;
  void input.userConfig;
  return input.ephemeral;
}

function assertOutsidePersonalConfig(configDir: string): void {
  const resolved = path.resolve(configDir);
  const personal = path.resolve(path.join(os.homedir(), PERSONAL_CONFIG_TAIL));
  const relative = path.relative(personal, resolved);
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (inside) {
    throw new OpenCodeAdapterError(
      "personal_config",
      "OPENCODE_CONFIG_DIR must not be the developer personal opencode config directory",
    );
  }
}

function assertOutsideWorktree(configDir: string, worktreePath: string): void {
  const relative = path.relative(path.resolve(worktreePath), path.resolve(configDir));
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (inside) {
    throw new OpenCodeAdapterError("config_dir_inside_worktree", "OPENCODE_CONFIG_DIR must sit outside the worktree");
  }
}

function readPreserve(paths: readonly string[]): Map<string, string> {
  const snapshot = new Map<string, string>();
  for (const file of paths) {
    snapshot.set(path.resolve(file), fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
  }
  return snapshot;
}

function assertPreserve(snapshot: Map<string, string>): void {
  for (const [file, before] of snapshot) {
    const after = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (after !== before) {
      throw new OpenCodeAdapterError("personal_config", `refusing to mutate ${file}`);
    }
  }
}

function assertInvariants(document: OpenCodeConfigDocument): void {
  const permission = document.permission;
  const checks: ReadonlyArray<readonly [string, string]> = [
    ["bash", "rm -rf /"],
    ["bash", "git push"],
    ["shell", "git push"],
    ["webfetch", "https://evil.com"],
    ["websearch", "query"],
    ["external_directory", "/etc/passwd"],
    ["doom_loop", "repeat"],
  ];
  for (const [action, resource] of checks) {
    if (evaluatePermission(permission, action, resource) !== "deny") {
      throw new OpenCodeAdapterError("permission_invariant", `${action} is not unconditionally denied`);
    }
  }
  if (document.compaction.auto !== false) {
    throw new OpenCodeAdapterError("permission_invariant", "silent auto-compaction must stay disabled");
  }
  const mcpNames = Object.keys(document.mcp);
  if (mcpNames.length !== 1 || mcpNames[0] !== "ef-harness") {
    throw new OpenCodeAdapterError("mcp_invariant", "only the leased ef-harness MCP server may be attached");
  }
}

export class OpenCodeConfigGenerator {
  generate(input: GenerateConfigInput): GeneratedOpenCodeConfig {
    assertOutsidePersonalConfig(input.configDir);
    assertOutsideWorktree(input.configDir, input.worktreePath);
    const preserve = readPreserve(input.preservePaths ?? []);
    const baseUrl = assertLoopbackUrl(input.connection.baseUrl, "provider baseURL");
    const mcpUrl = assertLoopbackUrl(input.mcp.url, "leased MCP url");
    if (input.mcp.bearerToken.trim().length === 0) {
      throw new OpenCodeAdapterError("mcp_invariant", "leased MCP bearer token is empty");
    }
    const edit = input.mode === "stripped" ? "deny" : "ask";
    const tools: OpenCodeTools =
      input.mode === "stripped"
        ? { bash: false, webfetch: false, websearch: false, edit: false, write: false }
        : { bash: false, webfetch: false, websearch: false };
    const ephemeral: OpenCodeConfigDocument = {
      $schema: "https://opencode.ai/config.json",
      compaction: { auto: false },
      tools,
      permission: {
        bash: "deny",
        shell: "deny",
        webfetch: "deny",
        websearch: "deny",
        external_directory: "deny",
        doom_loop: "deny",
        edit,
        write: edit,
      },
      mcp: {
        "ef-harness": {
          type: "remote",
          url: mcpUrl,
          enabled: true,
          headers: { Authorization: `Bearer ${input.mcp.bearerToken}` },
        },
      },
      model: `${input.connection.provider}/${input.connection.model}`,
      provider: {
        [input.connection.provider]: {
          options: { baseURL: baseUrl },
        },
      },
    };
    const document = resolveEffectiveOpenCodeConfig({
      ephemeral,
      repoConfig: input.repoConfig ?? null,
      userConfig: input.userConfig ?? null,
    });
    assertInvariants(document);
    const serialized = JSON.stringify(document);
    if (input.connection.apiKey && serialized.includes(input.connection.apiKey)) {
      throw new OpenCodeAdapterError("provider_route", "provider key must not be written into opencode.json");
    }
    fs.mkdirSync(input.configDir, { recursive: true });
    const configPath = path.join(path.resolve(input.configDir), "opencode.json");
    fs.writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    assertPreserve(preserve);
    const routed = providerEnv(input.connection);
    return {
      configDir: path.resolve(input.configDir),
      configPath,
      document,
      env: routed,
      providerEnv: routed,
    };
  }
}
