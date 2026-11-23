import path from "node:path";
import { CursorAdapterError } from "./errors.js";
import type { CursorLocalSandboxOptions, CursorMcpServer, SandboxTierId } from "./types.js";

export function buildSandboxOptions(input: {
  readonly worktree: string;
  readonly proxyUrl: string;
  readonly mcpServers: readonly CursorMcpServer[];
}): CursorLocalSandboxOptions {
  assertLoopback(input.proxyUrl);
  const workingDirectory = path.resolve(input.worktree);
  return {
    enabled: true,
    workingDirectory,
    writableRoots: [workingDirectory],
    network: {
      unrestricted: false,
      route: "loopback-allowlist-proxy",
      proxyUrl: input.proxyUrl,
      blockNonProviderEgress: true,
    },
    mcpServers: input.mcpServers,
  };
}

export function assertSandboxTier(tier: SandboxTierId, hold: boolean, reason: string): void {
  if (hold) {
    throw new CursorAdapterError("sandbox_tier_insufficient", reason || "No acceptable sandbox tier is available");
  }
}

function assertLoopback(proxyUrl: string): void {
  let hostname = "";
  try {
    hostname = new URL(proxyUrl).hostname;
  } catch (error) {
    throw new CursorAdapterError(
      "proxy_not_loopback",
      error instanceof Error ? error.message : "Cursor proxy URL is invalid",
    );
  }
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1") {
    throw new CursorAdapterError(
      "proxy_not_loopback",
      "Cursor network must route exclusively through the loopback allowlist proxy",
    );
  }
}
