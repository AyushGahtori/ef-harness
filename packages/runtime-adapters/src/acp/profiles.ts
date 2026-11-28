import type { AcpRuntimeId } from "./types.js";

export interface AcpCapabilityQuirks {
  readonly protocolVersion: number;
  readonly mcpTransport: "http" | "sse";
  readonly tolerateStdoutBanner: boolean;
  readonly steerMethod: "queue" | "session/steer";
}

export interface AcpRuntimeProfile {
  readonly id: AcpRuntimeId;
  readonly command: string;
  readonly args: readonly string[];
  readonly version: string;
  readonly envAllowlist: readonly string[];
  readonly quirks: AcpCapabilityQuirks;
}

const PROCESS_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "COMSPEC",
  "WINDIR",
  "TEMP",
  "TMP",
] as const;

function profile(
  id: AcpRuntimeId,
  command: string,
  args: readonly string[],
  quirks: Partial<AcpCapabilityQuirks> = {},
): AcpRuntimeProfile {
  return {
    id,
    command,
    args,
    version: "0.0.0",
    envAllowlist: PROCESS_ENV_ALLOWLIST,
    quirks: {
      protocolVersion: 1,
      mcpTransport: "http",
      tolerateStdoutBanner: true,
      steerMethod: "queue",
      ...quirks,
    },
  };
}

/**
 * Spawn profiles for the ACP family. Tasks 144–149 pass one of these into
 * `GenericAcpAdapter` instead of reimplementing framing, fs, or terminals.
 */
export const ACP_RUNTIME_PROFILES: Readonly<Record<AcpRuntimeId, AcpRuntimeProfile>> = {
  generic: profile("generic", "acp-agent", []),
  "codex-acp": profile("codex-acp", "codex-acp", []),
  "copilot-acp": profile("copilot-acp", "copilot", ["--acp", "--stdio"]),
  "cursor-acp": profile("cursor-acp", "cursor-agent", ["acp"]),
  "gemini-acp": profile("gemini-acp", "gemini", ["--acp"]),
  "opencode-acp": profile("opencode-acp", "opencode", ["acp"]),
};

export function scrubSpawnEnv(
  allowlist: readonly string[],
  injected: Readonly<Record<string, string>>,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of allowlist) {
    const value = source[key];
    if (typeof value === "string" && !isBlockedEnvKey(key)) env[key] = value;
  }
  for (const [key, value] of Object.entries(injected)) {
    if (isBlockedEnvKey(key)) continue;
    env[key] = value;
  }
  return env;
}

export function isBlockedEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (upper === "OPENAI_API_KEY" || upper === "ANTHROPIC_API_KEY" || upper === "GITHUB_TOKEN") return true;
  if (upper.startsWith("AWS_") || upper.startsWith("STRIPE_")) return true;
  return false;
}
